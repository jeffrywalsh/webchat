// server.js - Main chat server file with enhanced real-time friend management and message deletion
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import custom modules
const db = require('./config/database');
const sessionConfig = require('./config/session');
const socketHandlers = require('./socket/handlers');

// Import routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const { router: messageRoutes, setSocketIO: setMessageSocketIO } = require('./routes/messages'); // Enhanced messages routes
const uploadRoutes = require('./routes/upload');
const { router: friendsRoutes, setSocketIO: setFriendsSocketIO } = require('./routes/friends'); // Import with setSocketIO function
const conversationsRoutes = require('./routes/conversations');

// Import middleware
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
        methods: ['GET', 'POST']
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for development
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);

// CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000',
    credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware
app.use(sessionConfig);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Pass socket.io instance to routes for real-time updates
setFriendsSocketIO(io);
setMessageSocketIO(io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', authMiddleware.requireAuth, roomRoutes);
app.use('/api/messages', authMiddleware.requireAuth, messageRoutes);
app.use('/api/upload', authMiddleware.requireAuth, uploadRoutes);
app.use('/api/friends', authMiddleware.requireAuth, friendsRoutes);
app.use('/api/conversations', authMiddleware.requireAuth, conversationsRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Socket.io connection handling
io.use((socket, next) => {
    // Share session with socket.io
    const req = socket.request;
    const res = socket.request.res || {};
    sessionConfig(req, res, next);
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    console.log('Session data:', {
        hasSession: !!socket.request.session,
        userId: socket.request.session?.userId,
        username: socket.request.session?.username,
        sessionID: socket.request.sessionID
    });

    // Check if user is authenticated
    if (!socket.request.session || !socket.request.session.userId) {
        console.log('❌ Socket authentication failed - no session');
        socket.emit('error', 'Authentication required');
        socket.disconnect();
        return;
    }

    console.log('✅ Socket authenticated for user:', socket.request.session.username);

    try {
        // Initialize socket handlers
        socketHandlers(io, socket);
    } catch (error) {
        console.error('❌ Error initializing socket handlers:', error);
        socket.disconnect();
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        db.end();
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        db.end();
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Chat server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('✅ Real-time friend management enabled');
    console.log('✅ Real-time message deletion enabled');
});

module.exports = { app, server, io };