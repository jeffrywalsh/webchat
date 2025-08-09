// routes/linkPreview.js - Secure Link Preview Implementation
const express = require('express');
const { getLinkPreview } = require('link-preview-js');
const url = require('url');
const router = express.Router();

// Whitelist of allowed domains for security
const ALLOWED_DOMAINS = [
    'youtube.com', 'youtu.be', 'github.com', 'stackoverflow.com',
    'twitter.com', 'x.com', 'reddit.com', 'wikipedia.org',
    'docs.google.com', 'drive.google.com', 'medium.com',
    'dev.to', 'codepen.io', 'jsfiddle.net'
    // Add more trusted domains as needed
];

// Cache for link previews (in production, use Redis)
const previewCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Security validation for URLs
function validateUrl(linkUrl) {
    try {
        const parsedUrl = new URL(linkUrl);

        // Only allow HTTP/HTTPS
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
        }

        // Check against whitelist
        const domain = parsedUrl.hostname.toLowerCase().replace('www.', '');
        const isAllowed = ALLOWED_DOMAINS.some(allowedDomain =>
            domain === allowedDomain || domain.endsWith('.' + allowedDomain)
        );

        if (!isAllowed) {
            return { valid: false, error: 'Domain not in whitelist' };
        }

        // Prevent localhost/private IPs (basic check)
        if (domain.includes('localhost') || domain.includes('127.0.0.1') ||
            domain.includes('192.168.') || domain.includes('10.0.')) {
            return { valid: false, error: 'Private URLs not allowed' };
        }

        return { valid: true };
    } catch (error) {
        return { valid: false, error: 'Invalid URL format' };
    }
}

// Get link preview endpoint
router.post('/preview', async (req, res) => {
    try {
        const { url: linkUrl } = req.body;

        if (!linkUrl) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate URL
        const validation = validateUrl(linkUrl);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        // Check cache first
        const cacheKey = linkUrl.toLowerCase();
        const cached = previewCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            return res.json(cached.data);
        }

        // Fetch preview with security options
        const preview = await getLinkPreview(linkUrl, {
            timeout: 5000, // 5 second timeout
            followRedirects: 'manual', // Don't follow redirects automatically
            headers: {
                'User-Agent': 'IRCChatBot/1.0'
            },
            resolveDNS: false, // Prevent DNS rebinding attacks
        });

        // Sanitize and limit preview data
        const sanitizedPreview = {
            url: linkUrl,
            title: preview.title ? preview.title.slice(0, 200) : null,
            description: preview.description ? preview.description.slice(0, 500) : null,
            siteName: preview.siteName ? preview.siteName.slice(0, 100) : null,
            images: preview.images ? preview.images.slice(0, 1).map(img => ({
                url: img,
                // Only include image if from same domain
                safe: new URL(img).hostname === new URL(linkUrl).hostname
            })) : [],
            mediaType: preview.mediaType || 'website',
            contentType: preview.contentType,
            favicons: preview.favicons ? preview.favicons.slice(0, 1) : []
        };

        // Cache the result
        previewCache.set(cacheKey, {
            data: sanitizedPreview,
            timestamp: Date.now()
        });

        // Clean cache periodically
        if (previewCache.size > 1000) {
            const entries = Array.from(previewCache.entries());
            const expired = entries.filter(([_, value]) =>
                Date.now() - value.timestamp > CACHE_TTL
            );
            expired.forEach(([key]) => previewCache.delete(key));
        }

        res.json(sanitizedPreview);

    } catch (error) {
        console.error('Link preview error:', error);
        res.status(500).json({
            error: 'Failed to generate preview',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;

// routes/imageUpload.js - Secure Image Upload with Thumbnails
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage(); // Store in memory for processing

const fileFilter = (req, file, cb) => {
    // Allowed image types
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    }
});

// Ensure upload directories exist
async function ensureDirectories() {
    const dirs = ['./public/uploads/images', './public/uploads/thumbnails'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            console.error('Error creating directory:', dir, error);
        }
    }
}

// Image upload endpoint
router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        await ensureDirectories();

        // Generate unique filename
        const fileHash = crypto.createHash('md5').update(req.file.buffer).digest('hex');
        const timestamp = Date.now();
        const extension = path.extname(req.file.originalname).toLowerCase();
        const filename = `${timestamp}-${fileHash}${extension}`;
        const thumbnailFilename = `thumb-${filename}`;

        // Process and save original image
        const originalPath = path.join('./public/uploads/images', filename);
        await sharp(req.file.buffer)
            .resize(2048, 2048, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 85 })
            .toFile(originalPath);

        // Generate thumbnail
        const thumbnailPath = path.join('./public/uploads/thumbnails', thumbnailFilename);
        await sharp(req.file.buffer)
            .resize(300, 300, {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 75 })
            .toFile(thumbnailPath);

        // Get image metadata
        const metadata = await sharp(req.file.buffer).metadata();

        const imageData = {
            originalName: req.file.originalname,
            filename: filename,
            thumbnailFilename: thumbnailFilename,
            url: `/uploads/images/${filename}`,
            thumbnailUrl: `/uploads/thumbnails/${thumbnailFilename}`,
            size: req.file.size,
            width: metadata.width,
            height: metadata.height,
            mimetype: req.file.mimetype,
            uploadedAt: new Date().toISOString()
        };

        res.json({
            message: 'Image uploaded successfully',
            image: imageData
        });

    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({
            error: 'Failed to upload image',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Error handling middleware
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large (max 10MB)' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files' });
        }
    }

    if (error.message.includes('Invalid file type')) {
        return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Upload error' });
});

module.exports = router;