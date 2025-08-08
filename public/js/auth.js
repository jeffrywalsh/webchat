// public/js/auth.js - Client-side authentication handling
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already authenticated
    checkAuthStatus();

    // Handle login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Handle register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
});

// Check authentication status
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status', {
            method: 'GET',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.authenticated) {
            // User is authenticated, redirect to main chat if on auth pages
            if (window.location.pathname === '/login' || window.location.pathname === '/register') {
                window.location.href = '/';
            }
        } else {
            // User not authenticated, redirect to login if on main page
            if (window.location.pathname === '/') {
                window.location.href = '/login';
            }
        }
    } catch (error) {
        console.error('Auth status check failed:', error);
        // If on main page and can't verify auth, redirect to login
        if (window.location.pathname === '/') {
            window.location.href = '/login';
        }
    }
}

// Handle login form submission
async function handleLogin(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const loginData = {
        username: formData.get('username').trim(),
        password: formData.get('password')
    };

    // Validate form
    if (!loginData.username || !loginData.password) {
        showError('Please fill in all fields');
        return;
    }

    const loginBtn = document.getElementById('loginBtn');
    const originalText = loginBtn.textContent;

    try {
        // Disable button and show loading state
        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in...';
        hideError();

        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(loginData)
        });

        const data = await response.json();

        if (response.ok) {
            // Login successful
            console.log('Login successful:', data.user.username);
            window.location.href = '/';
        } else {
            // Login failed
            showError(data.error || 'Login failed');
        }

    } catch (error) {
        console.error('Login error:', error);
        showError('Network error. Please try again.');
    } finally {
        // Re-enable button
        loginBtn.disabled = false;
        loginBtn.textContent = originalText;
    }
}

// Handle register form submission
async function handleRegister(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const registerData = {
        username: formData.get('username').trim(),
        display_name: formData.get('display_name').trim(),
        email: formData.get('email').trim() || null,
        password: formData.get('password')
    };

    // Validate form
    if (!registerData.username || !registerData.display_name || !registerData.password) {
        showError('Please fill in all required fields');
        return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(registerData.username)) {
        showError('Username can only contain letters, numbers, and underscores');
        return;
    }

    // Validate password length
    if (registerData.password.length < 6) {
        showError('Password must be at least 6 characters long');
        return;
    }

    // Validate email if provided
    if (registerData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerData.email)) {
        showError('Please enter a valid email address');
        return;
    }

    const registerBtn = document.getElementById('registerBtn');
    const originalText = registerBtn.textContent;

    try {
        // Disable button and show loading state
        registerBtn.disabled = true;
        registerBtn.textContent = 'Creating account...';
        hideError();

        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(registerData)
        });

        const data = await response.json();

        if (response.ok) {
            // Registration successful
            console.log('Registration successful:', data.user.username);
            window.location.href = '/';
        } else {
            // Registration failed
            if (data.details && Array.isArray(data.details)) {
                showError(data.details.join(', '));
            } else {
                showError(data.error || 'Registration failed');
            }
        }

    } catch (error) {
        console.error('Registration error:', error);
        showError('Network error. Please try again.');
    } finally {
        // Re-enable button
        registerBtn.disabled = false;
        registerBtn.textContent = originalText;
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';

        // Auto-hide error after 5 seconds
        setTimeout(() => {
            hideError();
        }, 5000);
    }
}

// Hide error message
function hideError() {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

// Utility function to handle logout (can be called from other scripts)
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            console.log('Logout successful');
            window.location.href = '/login';
        } else {
            console.error('Logout failed');
            // Force redirect anyway
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect anyway
        window.location.href = '/login';
    }
}

// Make logout function available globally
window.logout = logout;