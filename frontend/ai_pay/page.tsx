'use client'
import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { resourcePayment, resourcePaymentConfirm } from '@/data/api'
import { useUserStore } from '@/store/user/userStore'
import toast from 'react-hot-toast'
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, TransactionInstruction, type ParsedAccountData } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress
} from '@solana/spl-token'
import bs58 from 'bs58'

// Solana 配置信息（Devnet）
const SOLANA_RPC_URL = 'https://solana-devnet.api.onfinality.io/public'
const SOLANA_USDC_MINT = 'UCSsmd2A8Ub8J2mE68pXKSSJLJmMTJyPfuT4h7YwpQA'
const SOLANA_PRIVATE_KEY = ''
const SOLANA_DECIMALS = 6

const amountToSmallestUnit = (value: string, decimals: number): bigint => {
  const [integerPart, fractionalPart = ''] = value.split('.')
  const cleanInteger = integerPart.replace(/\D/g, '') || '0'
  const cleanFraction = fractionalPart.replace(/\D/g, '')
  const paddedFraction = (cleanFraction + '0'.repeat(decimals)).slice(0, decimals)
  const combined = `${cleanInteger}${paddedFraction}`
  return BigInt(combined || '0')
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.toString()
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const getSolanaKeypair = (): Keypair => {
  let cleanedKey = SOLANA_PRIVATE_KEY.trim()
  try {
    const secretKeyBytes = bs58.decode(cleanedKey)
    return Keypair.fromSecretKey(secretKeyBytes)
  } catch (error) {
    console.error('Failed to create Solana keypair:', error)
    throw new Error('Solana 私钥格式不正确')
  }
}

const resolveDecimals = (decimals?: number | null, fallback: number = SOLANA_DECIMALS): number => {
  if (decimals === undefined || decimals === null) {
    return fallback
  }
  if (Number.isNaN(decimals) || decimals <= 0) {
    return fallback
  }
  return decimals
}

interface PaymentAccept {
  scheme: string
  network: string
  asset: string
  symbol: string
  decimals?: number | null
  payTo: string
  resource: string
  description: string
  nonce: string
  expires: number
}

interface PaymentResponse {
  x402Version: number
  accepts: PaymentAccept[]
  orderId: string
}

interface ChatMessage {
  text: string
  inversion: boolean // false 答，true 问
  error: boolean
  options?: { label: string; value: string }[] // 可选的按钮选项
}

type Step =
  | 'start'
  | 'pending_payment_info'
  | 'select_network'
  | 'select_amount'
  | 'pending_transfer'
  | 'pending_confirm'
  | 'success'
  | 'failed'

export default function Page() {
  const avatar = useUserStore((s) => s.user?.avatar || '')
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<Step>('start')
  const [chatList, setChatList] = useState<ChatMessage[]>([
    {
      text: '欢迎使用 AI 支付功能。点击下方按钮开始推广流程。',
      inversion: false,
      error: false
    }
  ])
  const [paymentOptions, setPaymentOptions] = useState<PaymentAccept[]>([])
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentAccept | null>(null)
  const [orderId, setOrderId] = useState<string>('')
  const [selectedAmount, setSelectedAmount] = useState<string>('')
  const [selectedToken, setSelectedToken] = useState<'USDC' | ''>('')
  const [selectedNetwork, setSelectedNetwork] = useState<string>('Solana Devnet')
  const [actualTransferAmount, setActualTransferAmount] = useState<string>('') // 记录实际转账的金额
  const [txHash, setTxHash] = useState<string>('')
  const [resourceid, setResourceid] = useState<string>('')
  
  // 钱包信息状态
  const [solWalletAddress, setSolWalletAddress] = useState<string>('')
  const [solBalance, setSolBalance] = useState<string>('0')
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(true)

  // 第一步：点击推广按钮
  const handleStartPromotion = async () => {
    try {
      // 添加用户消息
      setChatList((prev) => [
        ...prev,
        {
          text: '我需要帮我的推文进行推广',
          inversion: true,
          error: false
        }
      ])

      // 添加 pending 消息
      setChatList((prev) => [
        ...prev,
        {
          text: '正在获取支付信息...',
          inversion: false,
          error: false
        }
      ])

      setStep('pending_payment_info')
      setPaymentOptions([])
      setSelectedPaymentOption(null)
      setSelectedToken('')
      setSelectedNetwork('Solana Devnet')
      setSelectedAmount('')
      setActualTransferAmount('')
      setTxHash('')

      // 生成随机8个字母作为 resourceid
      const generateRandomLetters = (length: number): string => {
        const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        let result = ''
        for (let i = 0; i < length; i++) {
          result += letters.charAt(Math.floor(Math.random() * letters.length))
        }
        return result
      }
      
      const randomResourceId = generateRandomLetters(8)
      setResourceid(randomResourceId)
      console.log('生成的 resourceid:', randomResourceId)

      // 第二步：调用 resourcePayment 接口
      await fetchPaymentInfo(randomResourceId)
    } catch (error) {
      console.error('Error starting promotion:', error)
      setChatList((prev) => [
        ...prev,
        {
          text: '抱歉，启动推广流程时发生错误。',
          inversion: false,
          error: true
        }
      ])
      setStep('failed')
    }
  }

  // 第二步：获取支付信息
  const fetchPaymentInfo = async (resourceid: string) => {
    try {
      const res = await resourcePayment({ resourceid })

      if (res.code === 402) {
        // 处理 402 状态码，表示需要支付
        const data: PaymentResponse = res.data
        const solanaOptions = (data.accepts || []).filter((accept) =>
          (accept.network || '').toLowerCase().includes('sol')
        )
        if (solanaOptions.length > 0) {
          setPaymentOptions(solanaOptions)
          setOrderId(data.orderId)

          const optionButtons = solanaOptions.map((accept, index) => ({
            label: `${accept.network || 'Network'} · ${accept.symbol || accept.asset}`,
            value: `${index}`
          }))

          setChatList((prev) => {
            const newList = [...prev]
            newList[newList.length - 1] = {
              text: `已获取支付信息。\n\n请选择支付网络与代币：`,
              inversion: false,
              error: false,
              options: optionButtons
            }
            return newList
          })

          setStep('select_network')
        } else {
          throw new Error('No payment accepts found')
        }
      } else if (res.code === 200) {
        // 支付成功
        setStep('success')
        setChatList((prev) => [
          ...prev,
          {
            text: '支付已完成！',
            inversion: false,
            error: false
          }
        ])
      }
    } catch (error: any) {
      console.error('Failed to fetch payment info:', error)
      if (error?.response?.status === 402) {
        // 处理 402 响应
        const data = error?.response?.data
        const solanaOptions = (data?.accepts || []).filter((accept: PaymentAccept) =>
          (accept.network || '').toLowerCase().includes('sol')
        )
        if (solanaOptions.length > 0) {
          setPaymentOptions(solanaOptions)
          setOrderId(data.orderId)

          const optionButtons = solanaOptions.map((accept: PaymentAccept, index: number) => ({
            label: `${accept.network || 'Network'} · ${accept.symbol || accept.asset}`,
            value: `${index}`
          }))

          setChatList((prev) => {
            const newList = [...prev]
            newList[newList.length - 1] = {
              text: `已获取支付信息。\n\n请选择支付网络与代币：`,
              inversion: false,
              error: false,
              options: optionButtons
            }
            return newList
          })

          setStep('select_network')
        } else {
          throw error
        }
      } else {
        setChatList((prev) => {
          const newList = [...prev]
          if (newList.length > 0) {
            newList[newList.length - 1] = {
              text: '获取支付信息失败，请重试。',
              inversion: false,
              error: true
            }
          } else {
            newList.push({
              text: '获取支付信息失败，请重试。',
              inversion: false,
              error: true
            })
          }
          return newList
        })
        setStep('failed')
      }
    }
  }

  const handleSelectNetwork = (optionIndex: string) => {
    if (!paymentOptions.length) return

    const parsedIndex = Number(optionIndex)
    if (Number.isNaN(parsedIndex) || !paymentOptions[parsedIndex]) return

    const option = paymentOptions[parsedIndex]
    const tokenSymbol = (option.symbol || option.asset || 'USDC').toUpperCase()

    setSelectedPaymentOption(option)
    setSelectedNetwork(option.network || 'Solana Devnet')
    setSelectedToken('USDC')

    const amountOptions = [
      { label: `0.1 ${tokenSymbol}`, value: '0.1' },
      { label: `0.2 ${tokenSymbol}`, value: '0.2' },
      { label: `0.3 ${tokenSymbol}`, value: '0.3' }
    ]

    setChatList((prev) => [
      ...prev,
      {
        text: `${option.network || 'Network'} · ${tokenSymbol}`,
        inversion: true,
        error: false
      },
      {
        text: '请选择支付金额：',
        inversion: false,
        error: false,
        options: amountOptions
      }
    ])

    setStep('select_amount')
  }

  // 第三步：选择支付金额
  const handleSelectAmount = async (amount: string) => {
    if (!selectedPaymentOption || !selectedToken) return

    console.log('用户选择金额:', amount)
    setSelectedAmount(amount)
    setActualTransferAmount(amount) // 保存实际转账金额
    
    setChatList((prev) => [
      ...prev,
      {
        text: `${amount} ${selectedToken}`,
        inversion: true,
        error: false
      },
      {
        text: '正在发起转账...',
        inversion: false,
        error: false
      }
    ])

    setStep('pending_transfer')

    try {
      // 第四步：自动发起转账
      console.log('准备转账金额:', amount, 'to', selectedPaymentOption.payTo)
      const decimals = resolveDecimals(selectedPaymentOption.decimals, SOLANA_DECIMALS)
      const hash = await sendSolanaTransfer(selectedPaymentOption.payTo, amount, decimals)

      setTxHash(hash)
      console.log('转账完成，交易哈希:', hash, '转账金额:', amount)

      setChatList((prev) => {
        const newList = [...prev]
        newList[newList.length - 1] = {
          text: `转账已发送！\n\n交易哈希：${hash}\n\n等待交易确认...`,
          inversion: false,
          error: false
        }
        return newList
      })

      // 第五步：等待交易确认
      setStep('pending_confirm')

      // 第六步：确认支付
      await confirmPayment(hash, selectedPaymentOption, decimals)
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Transfer failed:', error)
      setChatList((prev) => {
        const newList = [...prev]
        newList[newList.length - 1] = {
          text: `转账失败：${message || '未知错误'}`,
          inversion: false,
          error: true
        }
        return newList
      })
      setStep('failed')
    }
  }

  const sendSolanaTransfer = async (toAddress: string, amount: string, decimals: number): Promise<string> => {
    try {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed')
      const payer = getSolanaKeypair()
      const payerAddress = payer.publicKey.toBase58()
      const recipient = new PublicKey(toAddress)
      const mint = new PublicKey(SOLANA_USDC_MINT)

      console.log('Solana payer address:', payerAddress)
      console.log('Solana recipient address:', recipient.toBase58())

      const fromTokenAccount = await getAssociatedTokenAddress(mint, payer.publicKey)
      let toTokenAccount: PublicKey = recipient

      const instructions: TransactionInstruction[] = []

      const fromInfo = await connection.getAccountInfo(fromTokenAccount)
      if (!fromInfo) {
        throw new Error('发送方缺少 USDC 关联账户，请先创建并充值 USDC')
      }

      const directAccountInfo = await connection.getAccountInfo(recipient)
      if (directAccountInfo && directAccountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        toTokenAccount = recipient

        const parsedInfo = await connection.getParsedAccountInfo(toTokenAccount)
        const parsedData = parsedInfo.value?.data as ParsedAccountData | undefined
        const accountMint = parsedData?.parsed?.info?.mint
        if (accountMint && accountMint !== SOLANA_USDC_MINT) {
          throw new Error('收款 Token 账户的 Mint 与 USDC 不匹配')
        }
      } else {
        toTokenAccount = await getAssociatedTokenAddress(mint, recipient, true)
        const ataInfo = await connection.getAccountInfo(toTokenAccount)

        if (!ataInfo) {
          instructions.push(
            createAssociatedTokenAccountInstruction(payer.publicKey, toTokenAccount, recipient, mint)
          )
        } else if (!ataInfo.owner.equals(TOKEN_PROGRAM_ID)) {
          throw new Error('关联 Token 账户的 Owner 非 SPL Token Program')
        } else {
          const parsedAtaInfo = await connection.getParsedAccountInfo(toTokenAccount)
          const parsedAtaData = parsedAtaInfo.value?.data as ParsedAccountData | undefined
          const ataMint = parsedAtaData?.parsed?.info?.mint
          if (ataMint && ataMint !== SOLANA_USDC_MINT) {
            throw new Error('关联 Token 账户的 Mint 与 USDC 不匹配')
          }
        }
      }

      const amountInSmallestUnit = amountToSmallestUnit(amount, decimals)

      const payerUsdcBalance = await connection.getTokenAccountBalance(fromTokenAccount)
      const payerUsdcLamports = BigInt(payerUsdcBalance.value?.amount || '0')
      if (payerUsdcLamports < amountInSmallestUnit) {
        throw new Error(
          `USDC 余额不足：当前 ${payerUsdcBalance.value?.uiAmountString || '0'}，需要 ${amount}`
        )
      }

      const lamports = await connection.getBalance(payer.publicKey)
      const minLamports = BigInt(10_000_000) // 0.01 SOL
      if (BigInt(lamports) < minLamports) {
        throw new Error('SOL 余额不足，请在 Devnet 领取一些 SOL 以支付手续费')
      }

      instructions.push(
        createTransferInstruction(
          fromTokenAccount,
          toTokenAccount,
          payer.publicKey,
          amountInSmallestUnit,
          [],
          TOKEN_PROGRAM_ID
        )
      )

      const transaction = new Transaction().add(...instructions)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight
      transaction.feePayer = payer.publicKey

      const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false })
      console.log('Solana transaction sent:', signature)

      await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight
        },
        'confirmed'
      )

      console.log('Solana transaction confirmed:', signature)

      setTimeout(() => {
        fetchWalletInfo()
      }, 2000)

      return signature
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Solana transfer error:', error)
      throw new Error(message || 'Solana 转账失败')
    }
  }

  // 第六步：确认支付
  const confirmPayment = async (txHash: string, paymentOption?: PaymentAccept | null, decimalsOverride?: number) => {
    if (!resourceid || !orderId) {
      throw new Error('缺少必要参数')
    }

    const option = paymentOption ?? selectedPaymentOption
    if (!option) {
      throw new Error('缺少支付配置')
    }

    try {
      setChatList((prev) => {
        const newList = [...prev]
        newList.push({
          text: '正在确认支付...',
          inversion: false,
          error: false
        })
        return newList
      })

      // 构建 X-PAYMENT header
      // 优先使用实际转账金额，如果没有则使用 selectedAmount
      const amountToUse = actualTransferAmount || selectedAmount
      console.log('构建 X-PAYMENT，使用的金额:', amountToUse)
      console.log('selectedAmount:', selectedAmount)
      console.log('actualTransferAmount:', actualTransferAmount)
      
      const decimalsToUse = decimalsOverride ?? resolveDecimals(option.decimals, 6)
      let amountInSmallestUnit = '0'
      amountInSmallestUnit = amountToSmallestUnit(amountToUse, decimalsToUse).toString()
      
      console.log('计算的 amountInSmallestUnit:', amountInSmallestUnit)
      
      const xPaymentData = {
        x402Version: 1,
        scheme: option.scheme || 'exact',
        network: option.network || selectedNetwork || 'Solana',
        orderId: orderId,
        payload: { amount: amountInSmallestUnit, txHash: txHash }
      }
      const xPaymentHeader = btoa(JSON.stringify(xPaymentData))
      console.log('X-PAYMENT data:', xPaymentData)
      console.log('X-PAYMENT payload amount:', xPaymentData.payload.amount)

      // 调用确认接口
      const res = await resourcePaymentConfirm({ resourceid }, xPaymentHeader)
      
      // 打印完整响应以便调试
      console.log('Payment confirm response:', res)
      console.log('Response code:', res.code)
      console.log('Response data:', res.data)
      console.log('Response status:', res.status)
      console.log('Response message:', res.message)

      // 检查响应状态
      // 如果 code 是 200，或者 HTTP 状态是 200 且没有 code 字段（可能是直接返回数据）
      const responseCode = res.code || res.status || (res.data?.code)
      const responseMessage = res.message || res.data?.message || ''
      
      // 如果响应中有 message 且是 "Waiting for Payment"，说明还在等待支付确认
      if (responseMessage === 'Waiting for Payment' || responseMessage.includes('Waiting')) {
        setChatList((prev) => {
          const newList = [...prev]
          newList[newList.length - 1] = {
            text: '支付已提交，等待系统确认中...\n\n请稍候，系统正在验证您的交易。',
            inversion: false,
            error: false
          }
          return newList
        })
        
        // 等待几秒后再次检查订单状态（可选：可以添加轮询逻辑）
        setTimeout(async () => {
          try {
            // 可以在这里添加轮询逻辑来检查订单状态
            // 或者直接标记为成功，因为交易已经提交
            setStep('success')
            setChatList((prev) => {
              const newList = [...prev]
              newList.push({
                text: '支付已成功提交！推广流程已完成。',
                inversion: false,
                error: false
              })
              return newList
            })
            toast.success('支付提交成功！')
          } catch (error) {
            console.error('Status check error:', error)
          }
        }, 2000)
        return
      }

      // 如果 code 是 200，或者响应成功
      if (responseCode === 200 || (!responseCode && !responseMessage)) {
        setStep('success')
        setChatList((prev) => {
          const newList = [...prev]
          newList[newList.length - 1] = {
            text: '支付确认成功！推广流程已完成。',
            inversion: false,
            error: false
          }
          return newList
        })
        toast.success('支付成功！')
      } else {
        // 如果响应中有其他状态，显示具体错误信息
        const errorMsg = responseMessage || `支付确认失败 (code: ${responseCode})`
        throw new Error(errorMsg)
      }
    } catch (error: any) {
      console.error('Confirm payment error:', error)
      setChatList((prev) => {
        const newList = [...prev]
        newList[newList.length - 1] = {
          text: `支付确认失败：${error.message || '未知错误'}`,
          inversion: false,
          error: true
        }
        return newList
      })
      setStep('failed')
      throw error
    }
  }

  // 滚动到底部
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
      }
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      })
    })
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom()
    }, 100)
    return () => clearTimeout(timer)
  }, [chatList])

  const fetchSolanaWalletInfo = async () => {
    try {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed')
      const keypair = getSolanaKeypair()
      const address = keypair.publicKey.toBase58()
      setSolWalletAddress(address)

      const lamports = await connection.getBalance(keypair.publicKey)
      setSolBalance((lamports / LAMPORTS_PER_SOL).toString())

      try {
        const mint = new PublicKey(SOLANA_USDC_MINT)
        const tokenAccount = await getAssociatedTokenAddress(mint, keypair.publicKey)
        const tokenInfo = await connection.getAccountInfo(tokenAccount)

        if (!tokenInfo) {
          setUsdcBalance('0')
        } else {
          const balance = await connection.getTokenAccountBalance(tokenAccount)
          setUsdcBalance(balance.value.uiAmountString || '0')
        }
      } catch (error) {
        console.error('Failed to fetch USDC balance on Solana:', error)
        setUsdcBalance('0')
      }
    } catch (error) {
      console.error('Failed to fetch Solana wallet info:', error)
      setSolWalletAddress('')
      setSolBalance('0')
      setUsdcBalance('0')
    }
  }

  // 获取钱包信息
  const fetchWalletInfo = async () => {
    setIsLoadingBalance(true)
    try {
      await fetchSolanaWalletInfo()
    } finally {
      setIsLoadingBalance(false)
    }
  }

  // 组件加载时获取钱包信息
  useEffect(() => {
    fetchWalletInfo()
    
    // 每30秒刷新一次余额
    const interval = setInterval(() => {
      fetchWalletInfo()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="my-[20px] md:my-[40px] mx-[12px] md:mx-20 h-auto md:h-[60%]">
      <div
        className="border-[4px] md:border-[8px] border-[#32331f] rounded-[16px] md:rounded-[32px] bg-[#23241c] bg-[url('/img/chat-bg.svg')] bg-cover bg-[center_top] bg-no-repeat w-full relative overflow-hidden"
        style={{ minHeight: '400px', height: 'calc(100vh - 120px)', maxHeight: 'calc(100vh - 120px)' }}
      >
        {/* 钱包信息显示 - 右上角 */}
        <div className="absolute top-2 right-2 md:top-4 md:right-4 z-10 bg-[#23241c]/95 backdrop-blur-sm border border-white/10 rounded-lg p-2 md:p-3 space-y-1.5 md:space-y-2 min-w-[140px] md:min-w-[200px] max-w-[160px] md:max-w-none">
          <div className="text-[10px] md:text-xs text-white/70 mb-1 md:mb-2 font-medium">钱包信息</div>
          
          {isLoadingBalance ? (
            <div className="text-[10px] md:text-xs text-white/50">加载中...</div>
          ) : (
            <>
              <div className="space-y-2 md:space-y-2.5">
                <div className="border-t border-white/10 pt-2 md:pt-3 space-y-1 md:space-y-1.5">
                  <div className="text-[9px] md:text-[11px] text-white/60 uppercase tracking-wide">Solana Devnet</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] md:text-xs text-white/70">地址:</span>
                    <span
                      className="text-[9px] md:text-xs text-white font-mono max-w-[70px] md:max-w-[120px] truncate"
                      title={solWalletAddress}
                    >
                      {solWalletAddress ? `${solWalletAddress.slice(0, 4)}...${solWalletAddress.slice(-3)}` : '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] md:text-xs text-white/70">SOL:</span>
                    <span className="text-[10px] md:text-xs text-[#E1FF01] font-medium">
                      {Number(solBalance || 0).toFixed(3)} SOL
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] md:text-xs text-white/70">USDC:</span>
                    <span className="text-[10px] md:text-xs text-[#E1FF01] font-medium">
                      {Number(usdcBalance || 0).toFixed(2)} USDC
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={fetchWalletInfo}
                className="mt-1 md:mt-2 text-[9px] md:text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                刷新余额
              </button>
            </>
          )}
        </div>
        <div
          ref={chatContainerRef}
          className="py-3 md:py-4 px-[12px] md:px-[40px] space-y-3 md:space-y-4 overflow-y-auto"
          style={{ minHeight: '300px', height: 'calc(100% - 100px)' }}
        >
          {chatList.map((item, index) => (
            <div key={index} className={`flex ${item.inversion ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[80%]`}>
                {item.inversion ? (
                  <div className="font-medium flex gap-[6px] md:gap-[8px] items-start">
                    <div className="bg-[#7f8f26] bg-opacity-90 px-[10px] md:px-[12px] py-[6px] md:py-[8px] rounded-[10px] md:rounded-[12px] border border-[#afc72b] break-words whitespace-pre-wrap text-sm md:text-base">
                      {item.text}
                    </div>
                    <div className="rounded-full overflow-hidden w-[24px] h-[24px] md:w-[30px] md:h-[30px] flex-shrink-0">
                      <Image
                        src={avatar || '/img/default-avatar.svg'}
                        alt="avatar"
                        width={30}
                        height={30}
                        className="object-cover"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap flex items-start gap-[6px] md:gap-[8px]">
                    <div className="rounded-full overflow-hidden w-[24px] h-[24px] md:w-[30px] md:h-[30px] flex-shrink-0">
                      <Image src="/svg/avatar.svg" alt="bot" width={30} height={30} className="object-cover" />
                    </div>
                    <div className="bg-[#44453e] bg-opacity-50 px-[10px] md:px-[12px] py-[6px] md:py-[8px] rounded-[10px] md:rounded-[12px] border border-[#545551] max-w-none break-words">
                      {!item.text ? (
                        <Loader />
                      ) : (
                        <div>
                          <div className="whitespace-pre-wrap text-sm md:text-base">{item.text}</div>
                          {item.options && item.options.length > 0 && (
                            <div className="mt-2 md:mt-3 flex flex-wrap gap-2">
                              {item.options.map((option, optIndex) => (
                                <Button
                                  key={optIndex}
                                  variant="ai"
                                  size="sm"
                                  onClick={() =>
                                    step === 'select_network'
                                      ? handleSelectNetwork(option.value)
                                      : handleSelectAmount(option.value)
                                  }
                                  disabled={!['select_network', 'select_amount'].includes(step)}
                                  className="text-[11px] md:text-xs px-3 md:px-4 py-1.5 md:py-2"
                                >
                                  {option.label}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="absolute bottom-[12px] md:bottom-[20px] left-1/2 transform -translate-x-1/2 px-[12px] md:px-[40px] w-full max-w-[400px] md:max-w-none md:w-[400px] flex justify-center">
          {step === 'start' && (
            <Button variant="ai" size="main" onClick={handleStartPromotion} className="w-full text-sm md:text-base px-4 md:px-6 py-2 md:py-3">
              我需要帮我的推文进行推广
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const Loader = () => {
  return (
    <div
      className="loader"
      style={{
        borderColor: 'transparent',
        width: '25px',
        aspectRatio: '4',
        background: `
          no-repeat radial-gradient(circle closest-side, #ffffff 90%, #ffffff00) 0% 50%,
          no-repeat radial-gradient(circle closest-side, #ffffff 90%, #ffffff00) 50% 50%,
          no-repeat radial-gradient(circle closest-side, #ffffff 90%, #ffffff00) 100% 50%
        `,
        backgroundSize: 'calc(100%/3) 100%',
        animation: 'l7 1s infinite linear'
      }}
    />
  )
}

