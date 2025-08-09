// public/js/media.js - Client-side Link Preview & Image Upload

// URL regex for detecting links in messages
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;

// Cache for link previews
const linkPreviewCache = new Map();

// Initialize media features
function initializeMediaFeatures() {
    setupImageUpload();
    setupLinkPreviewHandling();
    console.log('✅ Media features initialized');
}

// Setup image upload functionality
function setupImageUpload() {
    // Create image upload button
    const messageForm = document.getElementById('message-form');
    if (!messageForm) return;

    // Add image upload button to the form
    const uploadButton = document.createElement('button');
    uploadButton.type = 'button';
    uploadButton.className = 'btn btn-secondary btn-upload';
    uploadButton.innerHTML = '📷';
    uploadButton.title = 'Upload Image';
    uploadButton.style.marginRight = '5px';

    // Create hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/jpg,image/png,image/gif,image/webp';
    fileInput.style.display = 'none';
    fileInput.id = 'image-upload-input';

    // Insert upload button before send button
    const sendButton = messageForm.querySelector('.btn-send');
    sendButton.parentNode.insertBefore(uploadButton, sendButton);
    sendButton.parentNode.insertBefore(fileInput, sendButton);

    // Handle upload button click
    uploadButton.addEventListener('click', () => {
        fileInput.click();
    });

    // Handle file selection
    fileInput.addEventListener('change', handleImageUpload);
}

// Handle image upload
async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
        showNotification('Image too large. Maximum size is 10MB.', 'error');
        return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        showNotification('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.', 'error');
        return;
    }

    const uploadButton = document.querySelector('.btn-upload');
    const originalText = uploadButton.innerHTML;

    try {
        // Show uploading state
        uploadButton.innerHTML = '⏳';
        uploadButton.disabled = true;

        // Create form data
        const formData = new FormData();
        formData.append('image', file);

        // Upload image
        const response = await fetch('/api/upload/image', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }

        const data = await response.json();

        // Send image message via socket
        const imageMessage = {
            messageType: 'image',
            content: `[Image: ${data.image.originalName}]`,
            imageData: data.image
        };

        if (currentRoom) {
            socket.emit('send_message', {
                roomId: currentRoom,
                ...imageMessage
            });
        } else if (currentDMRecipientId) {
            socket.emit('send_dm', {
                recipientId: currentDMRecipientId,
                ...imageMessage
            });
        }

        showNotification('Image uploaded successfully!', 'success');

    } catch (error) {
        console.error('Image upload error:', error);
        showNotification(error.message, 'error');
    } finally {
        // Reset upload button
        uploadButton.innerHTML = originalText;
        uploadButton.disabled = false;

        // Clear file input
        event.target.value = '';
    }
}

// Setup link preview handling
function setupLinkPreviewHandling() {
    // Override the message handling to detect and preview links
    const originalAppendMessage = window.appendMessage;

    window.appendMessage = function(message, scroll = true) {
        // Call original function first
        originalAppendMessage(message, scroll);

        // Then check for links and images
        if (message.message_type === 'image' && message.imageData) {
            addImageToMessage(message);
        } else if (message.message_type === 'text' && message.content) {
            detectAndPreviewLinks(message);
        }
    };
}

// Add image display to message
function addImageToMessage(message) {
    // Find the message element
    const messageElements = document.querySelectorAll('.message');
    const lastMessage = messageElements[messageElements.length - 1];

    if (!lastMessage) return;

    // Create image container
    const imageContainer = document.createElement('div');
    imageContainer.className = 'message-image-container';
    imageContainer.style.cssText = `
        margin-top: 8px;
        border-radius: 8px;
        overflow: hidden;
        max-width: 300px;
        cursor: pointer;
        border: 1px solid #444;
    `;

    // Create thumbnail image
    const thumbnail = document.createElement('img');
    thumbnail.src = message.imageData.thumbnailUrl;
    thumbnail.alt = message.imageData.originalName;
    thumbnail.style.cssText = `
        width: 100%;
        height: auto;
        display: block;
        transition: opacity 0.2s;
    `;

    // Add hover effect
    thumbnail.addEventListener('mouseenter', () => {
        thumbnail.style.opacity = '0.8';
    });

    thumbnail.addEventListener('mouseleave', () => {
        thumbnail.style.opacity = '1';
    });

    // Add click to view full size
    thumbnail.addEventListener('click', () => {
        showImageModal(message.imageData);
    });

    // Add image info
    const imageInfo = document.createElement('div');
    imageInfo.className = 'image-info';
    imageInfo.style.cssText = `
        padding: 8px;
        background: #333;
        font-size: 11px;
        color: #888;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

    imageInfo.innerHTML = `
        <span>${escapeHtml(message.imageData.originalName)}</span>
        <span>${formatFileSize(message.imageData.size)}</span>
    `;

    imageContainer.appendChild(thumbnail);
    imageContainer.appendChild(imageInfo);

    // Add to message
    lastMessage.appendChild(imageContainer);
}

// Show image in modal
function showImageModal(imageData) {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        cursor: pointer;
    `;

    // Create image
    const image = document.createElement('img');
    image.src = imageData.url;
    image.alt = imageData.originalName;
    image.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
        cursor: default;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        font-size: 30px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create download button
    const downloadButton = document.createElement('a');
    downloadButton.href = imageData.url;
    downloadButton.download = imageData.originalName;
    downloadButton.innerHTML = '⬇️ Download';
    downloadButton.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 20px;
        text-decoration: none;
        border-radius: 5px;
        font-size: 14px;
    `;

    // Close modal function
    const closeModal = () => {
        modal.remove();
    };

    // Event listeners
    modal.addEventListener('click', closeModal);
    closeButton.addEventListener('click', closeModal);
    image.addEventListener('click', (e) => e.stopPropagation());
    downloadButton.addEventListener('click', (e) => e.stopPropagation());

    // Escape key to close
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    modal.appendChild(image);
    modal.appendChild(closeButton);
    modal.appendChild(downloadButton);
    document.body.appendChild(modal);
}

// Detect and preview links in messages
async function detectAndPreviewLinks(message) {
    const urls = message.content.match(URL_REGEX);
    if (!urls || urls.length === 0) return;

    // Find the message element
    const messageElements = document.querySelectorAll('.message');
    const lastMessage = messageElements[messageElements.length - 1];

    if (!lastMessage) return;

    // Process first URL only to avoid spam
    const url = urls[0];

    try {
        const preview = await getLinkPreview(url);
        if (preview) {
            addLinkPreviewToMessage(lastMessage, preview);
        }
    } catch (error) {
        console.error('Link preview error:', error);
        // Silently fail - don't show error to user
    }
}

// Get link preview from server
async function getLinkPreview(url) {
    // Check cache first
    if (linkPreviewCache.has(url)) {
        const cached = linkPreviewCache.get(url);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // 24 hours
            return cached.data;
        }
    }

    try {
        const response = await fetch('/api/preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            throw new Error('Preview failed');
        }

        const preview = await response.json();

        // Cache the result
        linkPreviewCache.set(url, {
            data: preview,
            timestamp: Date.now()
        });

        return preview;

    } catch (error) {
        console.error('Link preview fetch error:', error);
        return null;
    }
}

// Add link preview to message
function addLinkPreviewToMessage(messageElement, preview) {
    const previewContainer = document.createElement('div');
    previewContainer.className = 'link-preview';
    previewContainer.style.cssText = `
        margin-top: 8px;
        padding: 12px;
        border: 1px solid #444;
        border-radius: 8px;
        background: #2a2a2a;
        max-width: 400px;
        cursor: pointer;
        transition: background-color 0.2s;
    `;

    // Hover effect
    previewContainer.addEventListener('mouseenter', () => {
        previewContainer.style.backgroundColor = '#333';
    });

    previewContainer.addEventListener('mouseleave', () => {
        previewContainer.style.backgroundColor = '#2a2a2a';
    });

    // Click to open link
    previewContainer.addEventListener('click', () => {
        window.open(preview.url, '_blank', 'noopener,noreferrer');
    });

    let previewHTML = '';

    // Add image if available and safe
    if (preview.images && preview.images.length > 0 && preview.images[0].safe) {
        previewHTML += `
            <div class="preview-image" style="margin-bottom: 8px;">
                <img src="${escapeHtml(preview.images[0].url)}" 
                     alt="Preview" 
                     style="width: 100%; height: auto; max-height: 200px; object-fit: cover; border-radius: 4px;"
                     onerror="this.style.display='none'">
            </div>
        `;
    }

    // Add title
    if (preview.title) {
        previewHTML += `
            <div class="preview-title" style="font-weight: bold; color: #00ff00; margin-bottom: 4px; font-size: 14px;">
                ${escapeHtml(preview.title)}
            </div>
        `;
    }

    // Add description
    if (preview.description) {
        previewHTML += `
            <div class="preview-description" style="color: #ccc; font-size: 12px; margin-bottom: 4px;">
                ${escapeHtml(preview.description)}
            </div>
        `;
    }

    // Add site name and URL
    previewHTML += `
        <div class="preview-footer" style="color: #888; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
            <span>${escapeHtml(preview.siteName || new URL(preview.url).hostname)}</span>
            <span>🔗 ${escapeHtml(new URL(preview.url).hostname)}</span>
        </div>
    `;

    previewContainer.innerHTML = previewHTML;
    messageElement.appendChild(previewContainer);
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Enhanced message update for socket handlers (update to include media types)
function updateSocketHandlersForMedia() {
    // This function should be called after socket initialization
    if (!socket) return;

    // Update message sending to handle media
    const originalSendMessage = socket.emit;

    // Note: This is a conceptual approach - in practice, you'd modify the
    // existing socket handlers in the main chat.js file
}

// Make functions available globally
window.initializeMediaFeatures = initializeMediaFeatures;
window.addImageToMessage = addImageToMessage;
window.detectAndPreviewLinks = detectAndPreviewLinks;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMediaFeatures);
} else {
    initializeMediaFeatures();
}