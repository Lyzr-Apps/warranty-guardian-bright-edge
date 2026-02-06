'use client'

import { useState, useEffect, useRef } from 'react'
import { callAIAgent, uploadFiles } from '@/lib/aiAgent'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Upload, X, Settings, AlertCircle, CheckCircle, Clock, FileText, Mail, ChevronRight } from 'lucide-react'

// Agent IDs
const AGENT_IDS = {
  WARRANTY_ORCHESTRATOR: "69858a6da791e6e318b8de85",
  INVOICE_PARSING: "69858a1da791e6e318b8de73",
  ASSET_STATE_MANAGER: "69858a341caa4e686dd66e6a",
  CLAIM_DRAFTING: "69858a4b07ec48e3dc90a1d4"
}

// TypeScript Interfaces based on actual agent responses
interface InvoiceDetails {
  brand: string
  product_name: string
  purchase_date: string
  invoice_id: string
  retailer: string
  warranty_period: string
  confidence_scores: {
    brand: "HIGH" | "MEDIUM" | "LOW"
    product_name: "HIGH" | "MEDIUM" | "LOW"
    purchase_date: "HIGH" | "MEDIUM" | "LOW"
    invoice_id: "HIGH" | "MEDIUM" | "LOW"
    retailer: "HIGH" | "MEDIUM" | "LOW"
    warranty_period: "HIGH" | "MEDIUM" | "LOW"
  }
}

interface WarrantyStatus {
  warranty_status: "GREEN" | "YELLOW" | "RED" | "GREY"
  days_until_expiry: number
  expiry_date: string
  alert_schedule: string[]
  color_code: string
}

interface Product {
  id: string
  invoice_details: InvoiceDetails
  warranty_status: WarrantyStatus
  asset_ids?: string[]
  created_at: string
}

interface ClaimDraft {
  recipient_email: string
  subject_line: string
  email_body: string
  attachments_required: string[]
  product_details: {
    brand: string
    product_name: string
    invoice_id: string
    issue_description: string
  }
}

type FilterTab = 'all' | 'expiring_soon' | 'expired' | 'manual'

export default function Home() {
  // State
  const [products, setProducts] = useState<Product[]>([])
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [claimDraft, setClaimDraft] = useState<ClaimDraft | null>(null)
  const [issueDescription, setIssueDescription] = useState('')

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'parsing' | 'extracting' | 'complete' | 'error'>('idle')
  const [uploadMessage, setUploadMessage] = useState('')
  const [extractedDetails, setExtractedDetails] = useState<InvoiceDetails | null>(null)
  const [extractedWarranty, setExtractedWarranty] = useState<WarrantyStatus | null>(null)

  // Claim state
  const [claimLoading, setClaimLoading] = useState(false)
  const [claimError, setClaimError] = useState('')
  const [editableRecipient, setEditableRecipient] = useState('')
  const [editableSubject, setEditableSubject] = useState('')
  const [editableBody, setEditableBody] = useState('')

  // Settings state
  const [notifications, setNotifications] = useState({
    thirtyDay: true,
    sevenDay: true,
    dayOf: true
  })

  // Load products from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('warranty_products')
    if (stored) {
      try {
        setProducts(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to load products', e)
      }
    }
  }, [])

  // Save products to localStorage
  const saveProducts = (newProducts: Product[]) => {
    setProducts(newProducts)
    localStorage.setItem('warranty_products', JSON.stringify(newProducts))
  }

  // Filter products
  const filteredProducts = products.filter(product => {
    if (filterTab === 'all') return true
    if (filterTab === 'expiring_soon') {
      return product.warranty_status.warranty_status === 'YELLOW'
    }
    if (filterTab === 'expired') {
      return product.warranty_status.warranty_status === 'RED'
    }
    if (filterTab === 'manual') {
      return product.warranty_status.warranty_status === 'GREY'
    }
    return true
  })

  // Sort by urgency
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const statusOrder = { RED: 0, YELLOW: 1, GREEN: 2, GREY: 3 }
    const aOrder = statusOrder[a.warranty_status.warranty_status]
    const bOrder = statusOrder[b.warranty_status.warranty_status]

    if (aOrder !== bOrder) return aOrder - bOrder

    // Within same status, sort by days remaining
    return a.warranty_status.days_until_expiry - b.warranty_status.days_until_expiry
  })

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    if (!validTypes.includes(file.type)) {
      setUploadMessage('Please upload a PDF, JPG, or PNG file')
      setUploadStatus('error')
      return
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadMessage('File size must be less than 10MB')
      setUploadStatus('error')
      return
    }

    setUploadFile(file)
    setUploadStatus('idle')
    setUploadMessage('')
  }

  // Process invoice upload
  const processInvoice = async () => {
    if (!uploadFile) return

    try {
      // Step 1: Upload file
      setUploadStatus('uploading')
      setUploadMessage('Uploading invoice...')

      const uploadResult = await uploadFiles(uploadFile)

      if (!uploadResult.success) {
        setUploadStatus('error')
        setUploadMessage(uploadResult.error || 'Upload failed')
        return
      }

      const assetIds = uploadResult.asset_ids

      // Step 2: Parse invoice
      setUploadStatus('parsing')
      setUploadMessage('Parsing invoice details...')

      const parseResult = await callAIAgent(
        `Extract invoice details from the uploaded file`,
        AGENT_IDS.INVOICE_PARSING,
        { assets: assetIds }
      )

      if (!parseResult.success || parseResult.response.status !== 'success') {
        setUploadStatus('error')
        setUploadMessage('Failed to parse invoice')
        return
      }

      const invoiceDetails = parseResult.response.result as InvoiceDetails

      // Step 3: Get warranty status
      setUploadStatus('extracting')
      setUploadMessage('Calculating warranty status...')

      const warrantyMessage = `Classify warranty status for a product purchased on ${invoiceDetails.purchase_date} with ${invoiceDetails.warranty_period} warranty period. Today's date is ${new Date().toISOString().split('T')[0]}.`

      const warrantyResult = await callAIAgent(
        warrantyMessage,
        AGENT_IDS.ASSET_STATE_MANAGER
      )

      if (!warrantyResult.success || warrantyResult.response.status !== 'success') {
        setUploadStatus('error')
        setUploadMessage('Failed to calculate warranty status')
        return
      }

      const warrantyStatus = warrantyResult.response.result as WarrantyStatus

      // Save extracted data
      setExtractedDetails(invoiceDetails)
      setExtractedWarranty(warrantyStatus)
      setUploadStatus('complete')
      setUploadMessage('Invoice processed successfully!')

    } catch (error) {
      setUploadStatus('error')
      setUploadMessage(error instanceof Error ? error.message : 'Processing failed')
    }
  }

  // Add product to dashboard
  const addToDashboard = () => {
    if (!extractedDetails || !extractedWarranty) return

    const newProduct: Product = {
      id: Date.now().toString(),
      invoice_details: extractedDetails,
      warranty_status: extractedWarranty,
      created_at: new Date().toISOString()
    }

    saveProducts([...products, newProduct])

    // Reset upload modal
    setShowUploadModal(false)
    setUploadFile(null)
    setUploadStatus('idle')
    setUploadMessage('')
    setExtractedDetails(null)
    setExtractedWarranty(null)
  }

  // Open claim drafter
  const openClaimDrafter = async (product: Product) => {
    setSelectedProduct(product)
    setShowClaimModal(true)
    setClaimLoading(true)
    setClaimError('')
    setIssueDescription('')

    // Auto-generate claim draft
    try {
      const message = `Draft a warranty claim email for a ${product.invoice_details.brand} ${product.invoice_details.product_name} purchased on ${product.invoice_details.purchase_date} with invoice ID ${product.invoice_details.invoice_id} from ${product.invoice_details.retailer}. The product needs warranty service.`

      const result = await callAIAgent(message, AGENT_IDS.CLAIM_DRAFTING)

      if (result.success && result.response.status === 'success') {
        const draft = result.response.result as ClaimDraft
        setClaimDraft(draft)
        setEditableRecipient(draft.recipient_email)
        setEditableSubject(draft.subject_line)
        setEditableBody(draft.email_body)
      } else {
        setClaimError('Failed to generate claim draft')
      }
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Failed to load claim draft')
    } finally {
      setClaimLoading(false)
    }
  }

  // Get status badge styling
  const getStatusBadge = (status: string) => {
    const styles = {
      GREEN: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
      YELLOW: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Expiring Soon' },
      RED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Expired' },
      GREY: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'No Warranty' }
    }
    return styles[status as keyof typeof styles] || styles.GREY
  }

  // Get confidence badge styling
  const getConfidenceBadge = (confidence: string) => {
    const styles = {
      HIGH: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
      MEDIUM: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
      LOW: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' }
    }
    return styles[confidence as keyof typeof styles] || styles.MEDIUM
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Warranty Guardian</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className="text-gray-600 hover:text-gray-900"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <Button
            variant={filterTab === 'all' ? 'default' : 'outline'}
            onClick={() => setFilterTab('all')}
            className="whitespace-nowrap"
          >
            All
          </Button>
          <Button
            variant={filterTab === 'expiring_soon' ? 'default' : 'outline'}
            onClick={() => setFilterTab('expiring_soon')}
            className="whitespace-nowrap"
          >
            Expiring Soon
          </Button>
          <Button
            variant={filterTab === 'expired' ? 'default' : 'outline'}
            onClick={() => setFilterTab('expired')}
            className="whitespace-nowrap"
          >
            Expired
          </Button>
          <Button
            variant={filterTab === 'manual' ? 'default' : 'outline'}
            onClick={() => setFilterTab('manual')}
            className="whitespace-nowrap"
          >
            Manual Entry Required
          </Button>
        </div>

        {/* Empty State */}
        {sortedProducts.length === 0 && (
          <div className="text-center py-16">
            <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-gray-900 mb-2">No products yet</h2>
            <p className="text-gray-500 mb-6">Upload your first invoice to get started</p>
            <Button onClick={() => setShowUploadModal(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Invoice
            </Button>
          </div>
        )}

        {/* Product Grid */}
        {sortedProducts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedProducts.map((product) => {
              const statusBadge = getStatusBadge(product.warranty_status.warranty_status)

              return (
                <Card key={product.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    {/* Product Image Placeholder */}
                    <div className="w-full h-40 bg-gray-100 rounded-md mb-3 flex items-center justify-center">
                      <FileText className="h-12 w-12 text-gray-400" />
                    </div>

                    <CardTitle className="text-lg">
                      {product.invoice_details.brand} {product.invoice_details.product_name}
                    </CardTitle>

                    <div className="text-sm text-gray-500 space-y-1 mt-2">
                      <p>Purchased: {new Date(product.invoice_details.purchase_date).toLocaleDateString()}</p>
                      <p>Retailer: {product.invoice_details.retailer}</p>
                    </div>
                  </CardHeader>

                  <CardContent>
                    {/* Status Badge */}
                    <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mb-3 ${statusBadge.bg} ${statusBadge.text}`}>
                      {statusBadge.label}
                    </div>

                    {/* Days Remaining */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
                      <Clock className="h-4 w-4" />
                      <span>
                        {product.warranty_status.days_until_expiry > 0
                          ? `${product.warranty_status.days_until_expiry} days remaining`
                          : `Expired ${Math.abs(product.warranty_status.days_until_expiry)} days ago`
                        }
                      </span>
                    </div>

                    {/* Action Buttons */}
                    {(product.warranty_status.warranty_status === 'YELLOW' ||
                      product.warranty_status.warranty_status === 'RED') && (
                      <Button
                        onClick={() => openClaimDrafter(product)}
                        className="w-full"
                        variant="default"
                      >
                        Fix it
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}

                    {product.warranty_status.warranty_status === 'GREY' && (
                      <Button
                        onClick={() => {/* Manual entry logic */}}
                        className="w-full"
                        variant="outline"
                      >
                        Add Warranty
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      {/* Floating Upload Button */}
      {sortedProducts.length > 0 && (
        <button
          onClick={() => setShowUploadModal(true)}
          className="fixed bottom-6 right-6 bg-gray-900 text-white rounded-full p-4 shadow-lg hover:bg-gray-800 transition-colors"
          aria-label="Upload invoice"
        >
          <Upload className="h-6 w-6" />
        </button>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Upload Invoice</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowUploadModal(false)
                    setUploadFile(null)
                    setUploadStatus('idle')
                    setExtractedDetails(null)
                    setExtractedWarranty(null)
                  }}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* File Upload Area */}
              {uploadStatus === 'idle' && !uploadFile && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                  <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">Drop your invoice here or click to browse</p>
                  <p className="text-sm text-gray-500 mb-4">PDF, JPG, PNG up to 10MB</p>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    className="max-w-xs mx-auto"
                  />
                </div>
              )}

              {/* File Selected */}
              {uploadFile && uploadStatus === 'idle' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                    <FileText className="h-8 w-8 text-gray-600" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{uploadFile.name}</p>
                      <p className="text-sm text-gray-500">
                        {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button onClick={processInvoice} className="w-full">
                    Process Invoice
                  </Button>
                </div>
              )}

              {/* Processing States */}
              {(uploadStatus === 'uploading' || uploadStatus === 'parsing' || uploadStatus === 'extracting') && (
                <div className="text-center py-12">
                  <Loader2 className="h-12 w-12 animate-spin text-gray-900 mx-auto mb-4" />
                  <p className="text-gray-900 font-medium">{uploadMessage}</p>
                </div>
              )}

              {/* Error State */}
              {uploadStatus === 'error' && (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                  <p className="text-red-600 font-medium mb-4">{uploadMessage}</p>
                  <Button onClick={() => {
                    setUploadStatus('idle')
                    setUploadFile(null)
                  }}>
                    Try Again
                  </Button>
                </div>
              )}

              {/* Complete State - Preview */}
              {uploadStatus === 'complete' && extractedDetails && extractedWarranty && (
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-6 w-6" />
                    <span className="font-medium">{uploadMessage}</span>
                  </div>

                  {/* Extracted Details */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900">Extracted Details</h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-gray-500">Brand</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.brand}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.brand} />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Product</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.product_name}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.product_name} />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Purchase Date</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.purchase_date}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.purchase_date} />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Retailer</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.retailer}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.retailer} />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Invoice ID</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.invoice_id}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.invoice_id} />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Warranty Period</label>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{extractedDetails.warranty_period}</p>
                          <ConfidenceBadge confidence={extractedDetails.confidence_scores.warranty_period} />
                        </div>
                      </div>
                    </div>

                    {/* Warranty Status */}
                    <div className="pt-4 border-t">
                      <label className="text-sm text-gray-500">Warranty Status</label>
                      <div className="mt-2">
                        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(extractedWarranty.warranty_status).bg} ${getStatusBadge(extractedWarranty.warranty_status).text}`}>
                          {getStatusBadge(extractedWarranty.warranty_status).label}
                        </div>
                        <p className="text-sm text-gray-600 mt-2">
                          {extractedWarranty.days_until_expiry > 0
                            ? `Expires in ${extractedWarranty.days_until_expiry} days`
                            : `Expired ${Math.abs(extractedWarranty.days_until_expiry)} days ago`
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button onClick={addToDashboard} className="w-full">
                    Add to Dashboard
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Claim Drafter Modal */}
      {showClaimModal && selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Warranty Claim</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowClaimModal(false)
                    setSelectedProduct(null)
                    setClaimDraft(null)
                  }}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Loading State */}
              {claimLoading && (
                <div className="text-center py-12">
                  <Loader2 className="h-12 w-12 animate-spin text-gray-900 mx-auto mb-4" />
                  <p className="text-gray-600">Generating claim draft...</p>
                </div>
              )}

              {/* Error State */}
              {claimError && !claimLoading && (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                  <p className="text-red-600">{claimError}</p>
                </div>
              )}

              {/* Claim Form */}
              {!claimLoading && !claimError && claimDraft && (
                <div className="space-y-6">
                  {/* Product Info */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-medium text-gray-900 mb-2">
                      {selectedProduct.invoice_details.brand} {selectedProduct.invoice_details.product_name}
                    </h3>
                    <p className="text-sm text-gray-600">
                      Invoice: {selectedProduct.invoice_details.invoice_id}
                    </p>
                  </div>

                  {/* Connected Account Badge */}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="h-4 w-4" />
                    <span>Sending via Gmail (OAuth connected)</span>
                  </div>

                  {/* Recipient Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recipient Email
                    </label>
                    <Input
                      type="email"
                      value={editableRecipient}
                      onChange={(e) => setEditableRecipient(e.target.value)}
                    />
                  </div>

                  {/* Subject Line */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Subject
                    </label>
                    <Input
                      type="text"
                      value={editableSubject}
                      onChange={(e) => setEditableSubject(e.target.value)}
                    />
                  </div>

                  {/* Email Body */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message
                    </label>
                    <Textarea
                      value={editableBody}
                      onChange={(e) => setEditableBody(e.target.value)}
                      rows={12}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* Invoice Thumbnail */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-gray-600" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Original Invoice</p>
                        <p className="text-xs text-gray-500">Will be attached to email</p>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <Button
                      onClick={() => {
                        // Send email logic would go here
                        alert('Email sent! (Integration with Gmail/Outlook via Composio)')
                        setShowClaimModal(false)
                      }}
                      className="flex-1"
                    >
                      Send Email
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        alert('Draft saved!')
                        setShowClaimModal(false)
                      }}
                    >
                      Save Draft
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowClaimModal(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center sm:justify-end z-50">
          <div className="bg-white w-full sm:w-96 sm:h-full overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Settings</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSettings(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Email Connection Status */}
              <div className="mb-8">
                <h3 className="font-medium text-gray-900 mb-4">Email Connection</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-sm font-medium text-green-900">Gmail</span>
                    </div>
                    <span className="text-xs text-green-700">Connected</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-sm font-medium text-green-900">Outlook</span>
                    </div>
                    <span className="text-xs text-green-700">Connected</span>
                  </div>
                </div>
              </div>

              {/* Notification Preferences */}
              <div className="mb-8">
                <h3 className="font-medium text-gray-900 mb-4">Notification Preferences</h3>
                <div className="space-y-4">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">30-day reminder</span>
                    <input
                      type="checkbox"
                      checked={notifications.thirtyDay}
                      onChange={(e) => setNotifications(prev => ({ ...prev, thirtyDay: e.target.checked }))}
                      className="h-4 w-4"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">7-day reminder</span>
                    <input
                      type="checkbox"
                      checked={notifications.sevenDay}
                      onChange={(e) => setNotifications(prev => ({ ...prev, sevenDay: e.target.checked }))}
                      className="h-4 w-4"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Day-of reminder</span>
                    <input
                      type="checkbox"
                      checked={notifications.dayOf}
                      onChange={(e) => setNotifications(prev => ({ ...prev, dayOf: e.target.checked }))}
                      className="h-4 w-4"
                    />
                  </label>
                </div>
              </div>

              {/* Claim History */}
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Claim History</h3>
                <div className="text-sm text-gray-500 text-center py-8">
                  No claims submitted yet
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Confidence Badge Component
function ConfidenceBadge({ confidence }: { confidence: string }) {
  const badge = {
    HIGH: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'HIGH' },
    MEDIUM: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', label: 'MED' },
    LOW: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'LOW' }
  }[confidence] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', label: 'N/A' }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badge.bg} ${badge.text} ${badge.border}`}>
      {badge.label}
    </span>
  )
}
