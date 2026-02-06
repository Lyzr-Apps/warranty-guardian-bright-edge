# Email Integration Guide - Warranty Guardian

## Alternative Email Sending Methods

Since direct Gmail/Outlook integration requires backend OAuth flow, we've implemented three user-friendly alternatives:

### 1. Open in Email Client (Primary Method)
**How it works:**
- Clicking "Open in Email Client" uses the `mailto:` protocol
- Opens the user's default email application (Gmail, Outlook, Apple Mail, etc.)
- Pre-fills recipient, subject, and body
- User can review and send from their trusted email client

**Benefits:**
- No backend integration needed
- Works with any email client
- User maintains control over sending
- No OAuth configuration required

### 2. Copy to Clipboard
**How it works:**
- Copies the entire email (To, Subject, Body) to clipboard
- User can paste into any email client manually
- Works as a fallback if mailto: doesn't work

**Benefits:**
- Works in any browser
- User can paste into web-based email clients
- Simple and reliable

### 3. Download as .eml File
**How it works:**
- Creates a standard RFC822 .eml email file
- User downloads the file
- Can be opened in Outlook, Apple Mail, Thunderbird, etc.
- Double-clicking the file opens it in the default email client

**Benefits:**
- Preserves email formatting
- Can be saved for records
- Works with desktop email clients
- Professional email format

## Implementation Details

### Code Location
File: `/app/nextjs-project/app/page.tsx`

### Handler Functions

```typescript
// 1. mailto: link
const handleOpenInEmailClient = () => {
  const mailtoLink = `mailto:${encodeURIComponent(editableRecipient)}?subject=${encodeURIComponent(editableSubject)}&body=${encodeURIComponent(editableBody)}`
  window.location.href = mailtoLink
  setSendStatus({ type: 'success', message: 'Opening your default email client...' })
}

// 2. Copy to clipboard
const handleCopyToClipboard = async () => {
  const emailText = `To: ${editableRecipient}\nSubject: ${editableSubject}\n\n${editableBody}`
  await navigator.clipboard.writeText(emailText)
  setSendStatus({ type: 'success', message: 'Email content copied to clipboard!' })
}

// 3. Download .eml file
const handleDownloadDraft = () => {
  const emlContent = `To: ${editableRecipient}
Subject: ${editableSubject}
Content-Type: text/plain; charset=UTF-8

${editableBody}`

  const blob = new Blob([emlContent], { type: 'message/rfc822' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `warranty_claim_${selectedProduct?.invoice_details.invoice_id || 'draft'}.eml`
  link.click()
  URL.revokeObjectURL(url)
}
```

## User Experience Flow

1. User clicks "Fix it" on a product card
2. AI generates professional warranty claim email
3. User reviews and edits the email content
4. User chooses one of three sending methods:
   - **Open in Email Client** → Default email app opens with pre-filled content
   - **Copy Email** → Content copied to clipboard for manual paste
   - **Download .eml** → Email file downloaded for later use

## Why This Approach?

1. **No Backend Required**: All three methods work client-side
2. **No OAuth Flow**: User doesn't need to authenticate
3. **User Control**: User sends from their own email account
4. **Privacy**: No email credentials stored or managed
5. **Reliability**: Works across all browsers and email clients
6. **Flexibility**: User can choose their preferred method

## Future Enhancement Option

If you want direct sending in the future, you can:
1. Set up a backend API route
2. Use Composio OAuth for Gmail/Outlook
3. Store user tokens securely
4. Send emails via API

But for MVP and most use cases, these three alternatives provide excellent UX without complexity.
