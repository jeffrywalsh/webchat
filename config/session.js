// config/session.js - Session configuration
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
require('dotenv').config();

// MySQL session store options
const sessionStoreOptions = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'web_chat',
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 minutes
    expiration: parseInt(process.env.SESSION_MAX_AGE) || 86400000, // 24 hours
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
};

// Create session store
const sessionStore = new MySQLStore(sessionStoreOptions);

// Session configuration
const sessionConfig = session({
    key: 'chat_session',
    secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-this-in-production',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiration on activity
    cookie: {
        secure: false, // Set to false for development (HTTP)
        httpOnly: true, // Prevent XSS
        maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000, // 24 hours
        sameSite: 'lax' // CSRF protection
    },
    name: 'sessionId' // Hide default session name
});

// Test session store connection
sessionStore.ready = sessionStore.ready || (() => Promise.resolve());
sessionStore.ready()
    .then(() => {
        console.log('✅ Session store connected to MySQL');
    })
    .catch((error) => {
        console.error('❌ Session store error:', error);
    });

module.exports = sessionConfig;