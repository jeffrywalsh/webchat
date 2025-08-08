// public/js/chat.js - Enhanced IRC chat with complete friend management

// Chat application state
let socket = null;
let currentUser = null;
let currentRoom = null;
let currentDMRecipient = null;
let currentDMRecipientId = null;
let currentConversationId = null;
let typingTimeout = null;
let roomUsers = new Map();
let friends = new Map();
let friendshipStatuses = new Map(); // Track friendship status for each user
let dmConversations = new Map();
let availableChannels = [];
let contextMenuTarget = null;

document.addEventListener('DOMContentLoaded', function() {
    try {
        console.log('🚀 Starting enhanced chat with complete friend management');
        initializeChat();
        setupEventListeners();
        console.log('✅ Enhanced chat initialization completed');
    } catch (error) {
        console.error('❌ Chat initialization error:', error);
        showNotification('Failed to initialize chat application', 'error');
    }
});

// Initialize chat application
async function initializeChat() {
    try {
        const response = await fetch('/api/auth/status', {
            credentials: 'include'
        });

        const data = await response.json();

        if (!data.authenticated) {
            window.location.href = '/login';
            return;
        }

        currentUser = data.user;
        updateUserInfo();
        initializeSocket();

    } catch (error) {
        console.error('Failed to initialize chat:', error);
        window.location.href = '/login';
    }
}

// Enhanced event listeners setup
function setupEventListeners() {
    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error caught:', event.error);
        event.preventDefault();
    });

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (typeof window.logout === 'function') {
                window.logout();
            } else {
                fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
                    .then(() => window.location.href = '/login')
                    .catch(() => window.location.href = '/login');
            }
        });
    }

    // Message form and input
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');

    if (messageForm) messageForm.addEventListener('submit', sendMessage);
    if (messageInput) {
        messageInput.addEventListener('input', handleTyping);
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(e);
            }
        });
    }

    // Modal setup
    setupBrowseChannelsModal();
    setupCreateRoomModal();
    setupFriendRequestsModal();

    // Friend and DM management
    setupFriendManagement();
    setupDMManagement();

    // Leave channel button
    const leaveChannelBtn = document.getElementById('leave-channel-btn');
    if (leaveChannelBtn) {
        leaveChannelBtn.addEventListener('click', leaveCurrentChannel);
    }

    // Context menu handling
    setupContextMenu();

    // Click outside to close context menu
    document.addEventListener('click', () => {
        hideContextMenu();
    });
}

// Setup friend management
function setupFriendManagement() {
    const friendRequestsBtn = document.getElementById('friend-requests-btn');
    if (friendRequestsBtn) {
        friendRequestsBtn.addEventListener('click', () => {
            document.getElementById('friend-requests-modal').style.display = 'flex';
            loadAllFriendData();
        });
    }
}

// Setup DM management
function setupDMManagement() {
    const clearHiddenBtn = document.getElementById('clear-hidden-conversations-btn');
    if (clearHiddenBtn) {
        clearHiddenBtn.addEventListener('click', () => {
            showNotification('Feature coming soon!', 'info');
        });
    }
}

// Load all friend-related data for the modal
async function loadAllFriendData() {
    try {
        // Load received requests, sent requests, and current friends
        const [receivedResponse, sentResponse, friendsResponse] = await Promise.all([
            fetch('/api/friends/requests', { credentials: 'include' }),
            fetch('/api/friends/sent', { credentials: 'include' }),
            fetch('/api/friends', { credentials: 'include' })
        ]);

        const receivedData = await receivedResponse.json();
        const sentData = await sentResponse.json();
        const friendsData = await friendsResponse.json();

        displayAllFriendData(receivedData.requests, sentData.sentRequests, friendsData.friends);

    } catch (error) {
        console.error('Error loading friend data:', error);
        showNotification('Failed to load friend data', 'error');
    }
}

// Display all friend data in modal
function displayAllFriendData(receivedRequests, sentRequests, currentFriends) {
    const receivedList = document.getElementById('received-requests-list');
    const sentList = document.getElementById('sent-requests-list');
    const modalFriendsList = document.getElementById('modal-friends-list');

    // Display received requests
    displayReceivedRequests(receivedList, receivedRequests);

    // Display sent requests
    displaySentRequests(sentList, sentRequests);

    // Display current friends
    displayModalFriendsList(modalFriendsList, currentFriends);

    // Update notification badge
    updateFriendRequestsBadge(receivedRequests.length);
}

function displayReceivedRequests(container, requests) {
    if (requests.length === 0) {
        container.innerHTML = '<li class="empty-list">No pending requests</li>';
        return;
    }

    container.innerHTML = '';
    requests.forEach(request => {
        const li = document.createElement('li');
        li.className = 'friend-request-item';
        li.innerHTML = `
            <div class="friend-request-info">
                <div class="friend-request-name">${escapeHtml(request.display_name)}</div>
                <div class="friend-request-username">@${escapeHtml(request.username)}</div>
                <div class="friend-request-time">${formatTime(request.created_at)}</div>
            </div>
            <div class="friend-request-actions">
                <button class="btn btn-accept" data-friendship-id="${request.friendship_id}">Accept</button>
                <button class="btn btn-reject" data-friendship-id="${request.friendship_id}">Reject</button>
            </div>
        `;

        li.querySelector('.btn-accept').addEventListener('click', () => {
            acceptFriendRequest(request.friendship_id, request.display_name);
        });
        li.querySelector('.btn-reject').addEventListener('click', () => {
            rejectFriendRequest(request.friendship_id, request.display_name);
        });

        container.appendChild(li);
    });
}

function displaySentRequests(container, requests) {
    if (requests.length === 0) {
        container.innerHTML = '<li class="empty-list">No sent requests</li>';
        return;
    }

    container.innerHTML = '';
    requests.forEach(request => {
        const li = document.createElement('li');
        li.className = 'friend-request-item';
        li.innerHTML = `
            <div class="friend-request-info">
                <div class="friend-request-name">${escapeHtml(request.display_name)}</div>
                <div class="friend-request-username">@${escapeHtml(request.username)}</div>
                <div class="friend-request-time">${formatTime(request.created_at)} - ${request.status}</div>
            </div>
            <div class="friend-request-actions">
                <button class="btn btn-cancel" data-friendship-id="${request.friendship_id}">Cancel</button>
            </div>
        `;

        li.querySelector('.btn-cancel').addEventListener('click', () => {
            cancelFriendRequest(request.friendship_id, request.display_name);
        });

        container.appendChild(li);
    });
}

function displayModalFriendsList(container, friendsList) {
    if (friendsList.length === 0) {
        container.innerHTML = '<li class="empty-list">No friends yet</li>';
        return;
    }

    container.innerHTML = '';
    friendsList.forEach(friend => {
        const li = document.createElement('li');
        li.className = 'friend-request-item';
        li.innerHTML = `
            <div class="friend-request-info">
                <div class="friend-request-name">${escapeHtml(friend.display_name)}</div>
                <div class="friend-request-username">@${escapeHtml(friend.username)} • ${friend.status}</div>
                <div class="friend-request-time">Friends since ${formatTime(friend.friends_since)}</div>
            </div>
            <div class="friend-request-actions">
                <button class="dm-button" data-username="${friend.username}" data-userid="${friend.friend_id}">MSG</button>
                <button class="btn-remove-friend" data-friendship-id="${friend.friendship_id}" data-name="${friend.display_name}">Remove</button>
            </div>
        `;

        li.querySelector('.dm-button').addEventListener('click', () => {
            document.getElementById('friend-requests-modal').style.display = 'none';
            startDM(friend.username, friend.friend_id);
        });

        li.querySelector('.btn-remove-friend').addEventListener('click', () => {
            if (confirm(`Remove ${friend.display_name} from friends?`)) {
                removeFriend(friend.friendship_id, friend.display_name);
            }
        });

        container.appendChild(li);
    });
}

// Friend request actions
async function acceptFriendRequest(friendshipId, displayName) {
    try {
        const response = await fetch(`/api/friends/accept/${friendshipId}`, {
            method: 'PUT',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification(`You are now friends with ${displayName}!`, 'success');
            loadAllFriendData(); // Refresh modal
            loadFriends(); // Refresh sidebar
            refreshRoomUsers(); // Refresh channel users to update friend status
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to accept friend request', 'error');
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
        showNotification('Failed to accept friend request', 'error');
    }
}

async function rejectFriendRequest(friendshipId, displayName) {
    try {
        const response = await fetch(`/api/friends/reject/${friendshipId}`, {
            method: 'PUT',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification(`Rejected friend request from ${displayName}`, 'info');
            loadAllFriendData(); // Refresh modal
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to reject friend request', 'error');
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
        showNotification('Failed to reject friend request', 'error');
    }
}

async function cancelFriendRequest(friendshipId, displayName) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification(`Cancelled friend request to ${displayName}`, 'info');
            loadAllFriendData(); // Refresh modal
            refreshRoomUsers(); // Refresh channel users to update friend status
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to cancel friend request', 'error');
        }
    } catch (error) {
        console.error('Error cancelling friend request:', error);
        showNotification('Failed to cancel friend request', 'error');
    }
}

// Load user's friends
async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            displayFriends(data.friends);
        } else {
            console.error('Failed to load friends');
        }
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

// Display friends list in sidebar
function displayFriends(friendsList) {
    const friendsListElement = document.getElementById('friends-list');
    if (!friendsListElement) return;

    friends.clear();
    friendsListElement.innerHTML = '';

    if (friendsList.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-list';
        li.textContent = 'No friends yet';
        friendsListElement.appendChild(li);
        return;
    }

    friendsList.forEach(friend => {
        friends.set(friend.username, friend);

        const li = document.createElement('li');
        li.className = 'friend-item';
        li.innerHTML = `
            <div class="friend-info">
                <span class="user-status ${friend.status}"></span>
                <span>${friend.display_name}</span>
            </div>
            <div class="friend-actions">
                <button class="dm-button" data-username="${friend.username}" data-userid="${friend.friend_id}">MSG</button>
                <button class="btn-remove-friend" data-friendship-id="${friend.friendship_id}" data-name="${friend.display_name}">✖</button>
            </div>
        `;

        // Add event listeners
        li.querySelector('.dm-button').addEventListener('click', () => {
            startDM(friend.username, friend.friend_id);
        });

        li.querySelector('.btn-remove-friend').addEventListener('click', () => {
            if (confirm(`Remove ${friend.display_name} from friends?`)) {
                removeFriend(friend.friendship_id, friend.display_name);
            }
        });

        friendsListElement.appendChild(li);
    });
}

// Remove friend
async function removeFriend(friendshipId, displayName) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification(`Removed ${displayName} from friends`, 'info');
            loadFriends(); // Refresh friends list
            loadAllFriendData(); // Refresh modal if open
            refreshRoomUsers(); // Refresh channel users to update friend status
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to remove friend', 'error');
        }
    } catch (error) {
        console.error('Error removing friend:', error);
        showNotification('Failed to remove friend', 'error');
    }
}

// Send friend request
async function sendFriendRequest(userId, username) {
    try {
        const response = await fetch(`/api/friends/request/${userId}`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            showNotification(`Friend request sent to ${data.user.display_name}!`, 'success');
            refreshRoomUsers(); // Refresh channel users to update button states
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to send friend request', 'error');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        showNotification('Failed to send friend request', 'error');
    }
}

// Check friendship status for a user
async function checkFriendshipStatus(userId) {
    try {
        const response = await fetch(`/api/friends/status/${userId}`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            return data;
        }
    } catch (error) {
        console.error('Error checking friendship status:', error);
    }
    return { status: 'none' };
}

// Refresh room users with updated friend status
function refreshRoomUsers() {
    if (currentRoom) {
        socket.emit('get_room_users', { roomId: currentRoom });
    }
}

// Update friend requests badge
function updateFriendRequestsBadge(count) {
    const badge = document.getElementById('friend-requests-count');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Setup context menu
function setupContextMenu() {
    const contextMenu = document.getElementById('dm-context-menu');
    if (!contextMenu) return;

    // Handle context menu item clicks
    contextMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item || !contextMenuTarget) return;

        const action = item.dataset.action;
        const conversationId = contextMenuTarget.dataset.conversationId;
        const userId = contextMenuTarget.dataset.userId;
        const username = contextMenuTarget.dataset.username;

        switch (action) {
            case 'close':
                hideConversation(conversationId);
                break;
            case 'delete':
                deleteConversation(conversationId);
                break;
            case 'view-profile':
                showUserProfile(userId, username);
                break;
        }

        hideContextMenu();
    });
}

// Setup browse channels modal
function setupBrowseChannelsModal() {
    const browseBtn = document.getElementById('browse-channels-btn');
    const browseModal = document.getElementById('browse-channels-modal');
    const closeBrowseModal = document.getElementById('close-browse-modal');
    const channelSearch = document.getElementById('channel-search');

    if (browseBtn && browseModal) {
        browseBtn.addEventListener('click', () => {
            browseModal.style.display = 'flex';
            loadAvailableChannels();
        });
    }

    if (closeBrowseModal && browseModal) {
        closeBrowseModal.addEventListener('click', () => {
            browseModal.style.display = 'none';
        });
    }

    if (channelSearch) {
        channelSearch.addEventListener('input', function() {
            filterChannels(this.value.toLowerCase());
        });
    }

    if (browseModal) {
        window.addEventListener('click', (e) => {
            if (e.target === browseModal) {
                browseModal.style.display = 'none';
            }
        });
    }
}

// Setup create room modal
function setupCreateRoomModal() {
    const createRoomBtn = document.getElementById('create-room-btn');
    const createRoomModal = document.getElementById('create-room-modal');
    const createRoomForm = document.getElementById('create-room-form');
    const closeCreateModal = document.getElementById('close-create-modal');

    if (createRoomBtn && createRoomModal) {
        createRoomBtn.addEventListener('click', () => {
            createRoomModal.style.display = 'flex';
        });
    }

    if (closeCreateModal && createRoomModal) {
        closeCreateModal.addEventListener('click', () => {
            createRoomModal.style.display = 'none';
        });
    }

    if (createRoomForm) {
        createRoomForm.addEventListener('submit', createRoom);
    }

    if (createRoomModal) {
        window.addEventListener('click', (e) => {
            if (e.target === createRoomModal) {
                createRoomModal.style.display = 'none';
            }
        });
    }
}

// Setup friend requests modal
function setupFriendRequestsModal() {
    const friendRequestsModal = document.getElementById('friend-requests-modal');
    const closeFriendRequestsModal = document.getElementById('close-friend-requests-modal');

    if (closeFriendRequestsModal && friendRequestsModal) {
        closeFriendRequestsModal.addEventListener('click', () => {
            friendRequestsModal.style.display = 'none';
        });
    }

    if (friendRequestsModal) {
        window.addEventListener('click', (e) => {
            if (e.target === friendRequestsModal) {
                friendRequestsModal.style.display = 'none';
            }
        });
    }
}

// Load available channels for browsing
async function loadAvailableChannels() {
    try {
        const response = await fetch('/api/rooms/browse', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch channels');
        }

        const data = await response.json();
        availableChannels = data.rooms;
        displayAvailableChannels(availableChannels);

    } catch (error) {
        console.error('Error loading channels:', error);
        const channelsList = document.getElementById('available-channels');
        if (channelsList) {
            channelsList.innerHTML = '<li class="loading-item">Failed to load channels</li>';
        }
        showNotification('Failed to load channels', 'error');
    }
}

// Display available channels in the browser
function displayAvailableChannels(channels) {
    const channelsList = document.getElementById('available-channels');
    if (!channelsList) return;

    if (channels.length === 0) {
        channelsList.innerHTML = '<li class="loading-item">No public channels available</li>';
        return;
    }

    channelsList.innerHTML = '';

    channels.forEach(channel => {
        const li = document.createElement('li');
        li.className = 'channel-browser-item';
        li.dataset.channelId = channel.id;

        const channelName = channel.display_name.startsWith('#') ?
            channel.display_name : '#' + channel.display_name;

        li.innerHTML = `
            <div class="channel-info">
                <div class="channel-name">${escapeHtml(channelName)}</div>
                <div class="channel-description">${escapeHtml(channel.description || 'No description')}</div>
                <div class="channel-stats">Created by ${escapeHtml(channel.creator_name)}</div>
            </div>
            <div class="channel-actions">
                <span class="channel-member-count">${channel.member_count}</span>
                <button class="btn btn-join ${channel.is_member ? 'btn-secondary' : 'btn-primary'}" 
                        data-channel-id="${channel.id}" 
                        ${channel.is_member ? 'disabled' : ''}>
                    ${channel.is_member ? 'Joined' : 'Join'}
                </button>
            </div>
        `;

        // Add join button event listener
        const joinBtn = li.querySelector('.btn-join');
        if (joinBtn && !channel.is_member) {
            joinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                joinChannelFromBrowser(channel.id, channelName);
            });
        }

        // Add click to join functionality for the entire item
        if (!channel.is_member) {
            li.addEventListener('click', () => {
                joinChannelFromBrowser(channel.id, channelName);
            });
            li.style.cursor = 'pointer';
        }

        channelsList.appendChild(li);
    });
}

// Filter channels based on search input
function filterChannels(searchTerm) {
    if (!searchTerm) {
        displayAvailableChannels(availableChannels);
        return;
    }

    const filteredChannels = availableChannels.filter(channel =>
        channel.name.toLowerCase().includes(searchTerm) ||
        channel.display_name.toLowerCase().includes(searchTerm) ||
        (channel.description && channel.description.toLowerCase().includes(searchTerm))
    );

    displayAvailableChannels(filteredChannels);
}

// Join channel from browser
async function joinChannelFromBrowser(channelId, channelName) {
    try {
        const response = await fetch(`/api/rooms/${channelId}/join`, {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to join channel');
        }

        const data = await response.json();

        // Close the browse modal
        document.getElementById('browse-channels-modal').style.display = 'none';

        // Show success notification
        showNotification(`Joined ${channelName}!`, 'success');

        // The rooms list will be updated via socket
        socket.emit('get_user_rooms');

        // Auto-join the new channel
        setTimeout(() => {
            joinRoom(channelId, channelName);
        }, 500);

    } catch (error) {
        console.error('Error joining channel:', error);
        showNotification(error.message, 'error');
    }
}

// DM conversation management
async function hideConversation(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}/hide`, {
            method: 'PUT',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification('Conversation hidden', 'info');
            loadDMConversations(); // Refresh conversations list
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to hide conversation', 'error');
        }
    } catch (error) {
        console.error('Error hiding conversation:', error);
        showNotification('Failed to hide conversation', 'error');
    }
}

async function deleteConversation(conversationId) {
    if (!confirm('Delete this conversation? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/conversations/${conversationId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            showNotification(data.message, 'info');
            loadDMConversations(); // Refresh conversations list

            // If currently viewing this conversation, switch away
            if (currentConversationId == conversationId) {
                switchToWelcome();
            }
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to delete conversation', 'error');
        }
    } catch (error) {
        console.error('Error deleting conversation:', error);
        showNotification('Failed to delete conversation', 'error');
    }
}

function showUserProfile(userId, username) {
    showNotification(`Profile for ${username} - Coming soon!`, 'info');
}

// Context menu management
function showContextMenu(e, element) {
    e.preventDefault();
    const contextMenu = document.getElementById('dm-context-menu');
    if (!contextMenu) return;

    contextMenuTarget = element;

    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';

    // Adjust position if menu would go off screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideContextMenu() {
    const contextMenu = document.getElementById('dm-context-menu');
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    contextMenuTarget = null;
}

// Switch to welcome view
function switchToWelcome() {
    currentRoom = null;
    currentDMRecipient = null;
    currentDMRecipientId = null;
    currentConversationId = null;

    document.getElementById('chat-title').textContent = 'Select a channel to start chatting';
    document.getElementById('leave-channel-btn').style.display = 'none';
    document.getElementById('current-room-users-section').style.display = 'none';

    // Clear selections
    document.querySelectorAll('#rooms-list li').forEach(li => {
        li.classList.remove('active');
    });
    document.querySelectorAll('#dm-list li').forEach(li => {
        li.classList.remove('active');
    });

    // Show welcome message
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '<div class="welcome-message">Welcome to IRC Chat!<br>Select a channel from the sidebar to start chatting.</div>';
}

// Load DM conversations
async function loadDMConversations() {
    try {
        const response = await fetch('/api/conversations', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            handleDMConversations(data.conversations);
        } else {
            console.error('Failed to load DM conversations');
        }
    } catch (error) {
        console.error('Error loading DM conversations:', error);
    }
}

// Initialize Socket.io connection
function initializeSocket() {
    try {
        socket = io('/', {
            withCredentials: true,
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            console.log('✅ Connected to server', socket.id);
            updateConnectionStatus('connected');
            addSystemMessage('Connected to server');

            // Load initial data
            loadFriends();
            loadDMConversations();
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from server:', reason);
            updateConnectionStatus('disconnected');
            if (reason !== 'io client disconnect') {
                addSystemMessage('Disconnected from server: ' + reason);
            }
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Connection error:', error);
            updateConnectionStatus('disconnected');
            addSystemMessage('Connection error: ' + error.message);
        });

        socket.on('reconnect', () => {
            console.log('✅ Reconnected to server');
            updateConnectionStatus('connected');
            addSystemMessage('Reconnected to server');
        });

        socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
            addSystemMessage('Error: ' + error);
        });

        // Chat events
        socket.on('rooms_list', (data) => {
            try { handleRoomsList(data); } catch (e) { console.error('rooms_list error:', e); }
        });
        socket.on('room_messages', (data) => {
            try { handleRoomMessages(data); } catch (e) { console.error('room_messages error:', e); }
        });
        socket.on('room_users', (data) => {
            try { handleRoomUsers(data); } catch (e) { console.error('room_users error:', e); }
        });
        socket.on('new_message', (data) => {
            try { handleNewMessage(data); } catch (e) { console.error('new_message error:', e); }
        });
        socket.on('new_dm', (data) => {
            try { handleNewDM(data); } catch (e) { console.error('new_dm error:', e); }
        });
        socket.on('dm_messages', (data) => {
            try { handleDMMessages(data); } catch (e) { console.error('dm_messages error:', e); }
        });
        socket.on('dm_conversations', (data) => {
            try { handleDMConversations(data); } catch (e) { console.error('dm_conversations error:', e); }
        });
        socket.on('user_status_changed', (data) => {
            try { handleUserStatusChanged(data); } catch (e) { console.error('user_status_changed error:', e); }
        });
        socket.on('user_typing', (data) => {
            try { handleUserTyping(data); } catch (e) { console.error('user_typing error:', e); }
        });
        socket.on('user_stopped_typing', (data) => {
            try { handleUserStoppedTyping(data); } catch (e) { console.error('user_stopped_typing error:', e); }
        });
        socket.on('refresh_dm_conversations', () => {
            try {
                loadDMConversations();
            } catch (e) {
                console.error('refresh_dm_conversations error:', e);
            }
        });

        console.log('✅ Enhanced socket event handlers initialized');

    } catch (error) {
        console.error('❌ Socket initialization error:', error);
        showNotification('Failed to initialize socket connection', 'error');
    }
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.className = `connection-status ${status}`;
        statusEl.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
        statusEl.style.display = status === 'connected' ? 'none' : 'block';

        if (status === 'connected') {
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 2000);
        }
    }
}

// Update user info in UI
function updateUserInfo() {
    const userNameElement = document.getElementById('current-user-name');
    if (userNameElement && currentUser) {
        userNameElement.textContent = currentUser.display_name;
    }
}

// Handle rooms list with IRC-style channel names
function handleRoomsList(rooms) {
    const roomsList = document.getElementById('rooms-list');
    if (!roomsList) return;

    roomsList.innerHTML = '';

    rooms.forEach(room => {
        const li = document.createElement('li');
        li.textContent = room.display_name.startsWith('#') ? room.display_name : '#' + room.display_name.replace('#', '');
        li.dataset.roomId = room.id;
        li.addEventListener('click', () => joinRoom(room.id, room.display_name));
        roomsList.appendChild(li);
    });

    // Auto-join the main channel if available and no room is selected
    if (!currentRoom && rooms.length > 0) {
        const mainRoom = rooms.find(room => room.name === 'main') || rooms[0];
        joinRoom(mainRoom.id, mainRoom.display_name);
    }
}

// Handle room messages
function handleRoomMessages(data) {
    const { roomId, messages } = data;

    if (roomId !== currentRoom) return;

    displayMessages(messages);
}

// Handle room users list with enhanced friend management
function handleRoomUsers(data) {
    console.log('📊 Room users received:', data);
    const { roomId, users } = data;

    if (roomId != currentRoom) {
        console.log('❌ Room users for different room, ignoring');
        return;
    }

    roomUsers.clear();
    users.forEach(user => {
        roomUsers.set(user.username, user);
    });

    console.log('✅ Updated room users:', Array.from(roomUsers.keys()));
    updateCurrentRoomUsers();
}

// Update current room users display with enhanced friend management
async function updateCurrentRoomUsers() {
    const currentRoomUsersSection = document.getElementById('current-room-users-section');
    const currentRoomUsersList = document.getElementById('current-room-users');
    const currentRoomUsersTitle = document.getElementById('current-room-users-title');

    if (!currentRoom) {
        currentRoomUsersSection.style.display = 'none';
        return;
    }

    currentRoomUsersSection.style.display = 'block';

    const roomName = document.getElementById('chat-title').textContent;
    currentRoomUsersTitle.textContent = `👥 In ${roomName}`;

    currentRoomUsersList.innerHTML = '';

    const users = Array.from(roomUsers.values()).sort((a, b) => {
        if (a.username === currentUser.username) return -1;
        if (b.username === currentUser.username) return 1;
        return a.username.localeCompare(b.username);
    });

    // Load friendship statuses for all users
    const friendshipStatuses = new Map();
    await Promise.all(users.map(async user => {
        if (user.username !== currentUser.username) {
            const status = await checkFriendshipStatus(user.id);
            friendshipStatuses.set(user.id, status);
        }
    }));

    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'channel-user';

        if (user.username === currentUser.username) {
            li.innerHTML = `
                <div class="channel-user-info">
                    <span style="color: #ffff00;">${user.username} (you)</span>
                </div>
            `;
        } else {
            const friendshipStatus = friendshipStatuses.get(user.id) || { status: 'none' };
            const isFriend = friends.has(user.username);

            let statusBadge = '';
            let friendButton = '';

            if (isFriend) {
                statusBadge = '<span class="friend-status-badge is-friend">★</span>';
                friendButton = '';
            } else if (friendshipStatus.status === 'sent_request') {
                statusBadge = '<span class="friend-status-badge pending-sent">⏳</span>';
                friendButton = `<button class="btn btn-cancel btn-small" onclick="cancelFriendRequest(${friendshipStatus.friendship_id}, '${user.username}')">Cancel</button>`;
            } else if (friendshipStatus.status === 'received_request') {
                statusBadge = '<span class="friend-status-badge pending-received">📬</span>';
                friendButton = `
                    <button class="btn btn-accept btn-small" onclick="acceptFriendRequest(${friendshipStatus.friendship_id}, '${user.username}')">Accept</button>
                    <button class="btn btn-reject btn-small" onclick="rejectFriendRequest(${friendshipStatus.friendship_id}, '${user.username}')">Reject</button>
                `;
            } else {
                friendButton = `<button class="btn-add-friend btn-small" onclick="sendFriendRequest(${user.id}, '${user.username}')">+ Friend</button>`;
            }

            li.innerHTML = `
                <div class="channel-user-info">
                    ${statusBadge}
                    <span class="room-user">${user.username}</span>
                </div>
                <div class="channel-user-actions">
                    <button class="dm-button" data-username="${user.username}" data-userid="${user.id}">MSG</button>
                    ${friendButton}
                </div>
            `;

            const msgBtn = li.querySelector('.dm-button');
            if (msgBtn) {
                msgBtn.addEventListener('click', () => startDM(user.username, user.id));
            }
        }

        currentRoomUsersList.appendChild(li);
    });
}

// Handle DM conversations list
function handleDMConversations(conversations) {
    console.log('💬 DM conversations received:', conversations);
    const dmList = document.getElementById('dm-list');
    if (!dmList) return;

    dmList.innerHTML = '';
    dmConversations.clear();

    if (conversations.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-list';
        li.textContent = 'No private messages';
        dmList.appendChild(li);
        return;
    }

    conversations.forEach(conv => {
        const otherUser = conv.other_user;
        const li = document.createElement('li');
        li.className = 'dm-conversation';
        li.dataset.userId = otherUser.id;
        li.dataset.username = otherUser.username;
        li.dataset.conversationId = conv.id;

        li.innerHTML = `
            <span class="dm-conversation-name">${otherUser.username}</span>
            <div class="dm-conversation-actions">
                <button class="dm-action-btn" title="Close">👁️‍🗨️</button>
                <button class="dm-action-btn" title="Delete">🗑️</button>
            </div>
        `;

        // Add event listeners
        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('dm-action-btn')) {
                startDM(otherUser.username, otherUser.id, conv.id);
            }
        });

        // Right-click context menu
        li.addEventListener('contextmenu', (e) => {
            showContextMenu(e, li);
        });

        // Action buttons
        const closeBtn = li.querySelector('.dm-action-btn[title="Close"]');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideConversation(conv.id);
        });

        const deleteBtn = li.querySelector('.dm-action-btn[title="Delete"]');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConversation(conv.id);
        });

        dmList.appendChild(li);
        dmConversations.set(otherUser.username, conv);
    });
}

// Handle new message
function handleNewMessage(message) {
    if (message.room_id === currentRoom) {
        appendMessage(message);
    } else {
        showNotification(`New message in a channel`, 'info');
    }
}

// Handle DM messages
function handleDMMessages(data) {
    console.log('📨 DM messages received:', data);
    const { recipientId, messages } = data;

    if (currentDMRecipientId == recipientId) {
        console.log('✅ Displaying DM messages for current conversation');
        displayMessages(messages);
    } else {
        console.log('❌ DM messages for different conversation, ignoring');
    }
}

// Handle new DM message
function handleNewDM(message) {
    console.log('📨 New DM received:', message);

    const isCurrentConversation = (
        (message.sender_id == currentDMRecipientId) ||
        (message.recipient_id == currentDMRecipientId)
    );

    console.log('🔍 Is current conversation?', isCurrentConversation, {
        messageSenderId: message.sender_id,
        messageRecipientId: message.recipient_id,
        currentDMRecipientId: currentDMRecipientId
    });

    if (isCurrentConversation) {
        appendMessage(message);
    } else {
        const senderName = message.username || message.display_name;
        showNotification(`New message from ${senderName}`, 'info');
        loadDMConversations(); // Refresh conversations list
    }
}

// Join a room with IRC-style feedback
function joinRoom(roomId, roomName) {
    currentRoom = roomId;
    currentDMRecipient = null;
    currentDMRecipientId = null;
    currentConversationId = null;

    document.getElementById('chat-title').textContent = roomName;
    document.getElementById('leave-channel-btn').style.display = 'inline-block';

    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '<div class="loading">Joining channel...</div>';

    document.querySelectorAll('#rooms-list li').forEach(li => {
        li.classList.remove('active');
    });
    document.querySelector(`#rooms-list li[data-room-id="${roomId}"]`)?.classList.add('active');

    document.querySelectorAll('#dm-list li').forEach(li => {
        li.classList.remove('active');
    });

    socket.emit('join_room', { roomId });

    setTimeout(() => {
        if (currentRoom === roomId) {
            addSystemMessage(`Now talking in ${roomName}`);
        }
    }, 100);
}

// Start a direct message conversation
function startDM(username, userId, conversationId = null) {
    if (username === currentUser.username) return;

    console.log('🔵 Starting DM with:', { username, userId, conversationId });

    userId = parseInt(userId);

    if (!userId || isNaN(userId)) {
        console.error('❌ Invalid user ID for DM:', userId);
        showNotification('Cannot start conversation: Invalid user', 'error');
        return;
    }

    currentRoom = null;
    currentDMRecipient = username;
    currentDMRecipientId = userId;
    currentConversationId = conversationId;

    console.log('✅ DM state set:', { currentDMRecipient, currentDMRecipientId, currentConversationId });

    document.getElementById('chat-title').textContent = `💬 Private Message: ${username}`;
    document.getElementById('leave-channel-btn').style.display = 'none';
    document.getElementById('current-room-users-section').style.display = 'none';

    document.querySelectorAll('#rooms-list li').forEach(li => {
        li.classList.remove('active');
    });

    document.querySelectorAll('#dm-list li').forEach(li => {
        li.classList.remove('active');
    });
    document.querySelector(`#dm-list li[data-user-id="${userId}"]`)?.classList.add('active');

    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '<div class="loading">Loading conversation...</div>';

    console.log('📤 Requesting DM messages for user:', userId);
    socket.emit('get_dm_messages', { recipientId: userId, limit: 50, offset: 0 });

    addSystemMessage(`Private conversation with ${username}`);
}

// Enhanced leave current channel with auto-deletion support
async function leaveCurrentChannel() {
    if (!currentRoom) {
        showNotification('You are not in a channel', 'warning');
        return;
    }

    const roomName = document.getElementById('chat-title').textContent;
    console.log('🔴 Leaving channel:', currentRoom);

    try {
        const response = await fetch(`/api/rooms/${currentRoom}/leave`, {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to leave channel');
        }

        const data = await response.json();

        socket.emit('leave_room', { roomId: currentRoom });

        // Reset state
        currentRoom = null;
        currentDMRecipient = null;
        currentDMRecipientId = null;
        currentConversationId = null;

        document.getElementById('chat-title').textContent = '📺 Select a channel to join';
        document.getElementById('leave-channel-btn').style.display = 'none';
        document.getElementById('current-room-users-section').style.display = 'none';

        document.querySelectorAll('#rooms-list li').forEach(li => {
            li.classList.remove('active');
        });
        document.querySelectorAll('#dm-list li').forEach(li => {
            li.classList.remove('active');
        });

        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.innerHTML = '<div class="welcome-message">Select a channel to join the conversation</div>';

        addSystemMessage(data.message);
        showNotification(data.message, 'info');

        // If the room was deleted, extra notification
        if (data.room?.deleted) {
            showNotification('Channel was automatically deleted (empty)', 'warning');
        }

    } catch (error) {
        console.error('Error leaving channel:', error);
        showNotification(error.message, 'error');
    }
}

// Display messages in chat
function displayMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="welcome-message">Welcome to the channel! Start chatting...</div>';
        return;
    }

    messages.forEach(message => {
        appendMessage(message, false);
    });

    scrollToBottom();
}

// Append a single message in IRC style
function appendMessage(message, scroll = true) {
    const messagesContainer = document.getElementById('chat-messages');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';

    if (message.sender_id === currentUser?.id) {
        messageDiv.classList.add('own');
    }

    const timestamp = formatTime(message.created_at);
    const username = message.display_name || message.username;
    const content = escapeHtml(message.content);

    messageDiv.innerHTML = `
        <div class="message-line">
            <span class="message-timestamp">[${timestamp}]</span>
            <span class="message-nick">&lt;${username}&gt;</span>
            <span class="message-content">${content}</span>
        </div>
    `;

    messagesContainer.appendChild(messageDiv);

    if (scroll) {
        scrollToBottom();
    }
}

// Add system message (for joins, leaves, etc.)
function addSystemMessage(message) {
    const messagesContainer = document.getElementById('chat-messages');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';

    const timestamp = formatTime(new Date());

    messageDiv.innerHTML = `
        <div class="message-line">
            <span class="message-timestamp">[${timestamp}]</span>
            <span class="message-nick">***</span>
            <span class="message-content">${escapeHtml(message)}</span>
        </div>
    `;

    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

// Send message (updated for DM support)
function sendMessage(event) {
    event.preventDefault();

    const messageInput = document.getElementById('message-input');
    const content = messageInput.value.trim();

    console.log('📤 Attempting to send message:', {
        content: content,
        currentRoom: currentRoom,
        currentDMRecipient: currentDMRecipient,
        currentDMRecipientId: currentDMRecipientId,
        socketConnected: socket?.connected
    });

    if (!content) {
        console.log('❌ No content to send');
        return;
    }

    if (!socket || !socket.connected) {
        console.error('❌ Socket not connected');
        showNotification('Not connected to server', 'error');
        return;
    }

    if (currentRoom) {
        console.log('📤 Sending room message:', { roomId: currentRoom, content: content });

        socket.emit('send_message', {
            roomId: currentRoom,
            content: content,
            messageType: 'text'
        });

        console.log('✅ Room message sent to server');

    } else if (currentDMRecipient && currentDMRecipientId) {
        console.log('📤 Sending DM:', { recipientId: currentDMRecipientId, content: content });

        socket.emit('send_dm', {
            recipientId: currentDMRecipientId,
            content: content,
            messageType: 'text'
        });

        console.log('✅ DM sent to server');

    } else {
        console.log('❌ No room or recipient selected');
        showNotification('Please select a channel or start a private message', 'warning');
        return;
    }

    messageInput.value = '';
}

// Handle user status changes
function handleUserStatusChanged(data) {
    const { username, status } = data;

    if (status === 'online') {
        addSystemMessage(`${username} has joined the server`);
    } else if (status === 'offline') {
        addSystemMessage(`${username} has left the server`);
    }

    // Update friends list to reflect status changes
    loadFriends();

    console.log(`User ${username} is now ${status}`);
}

// Handle typing indicators
function handleTyping() {
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }

    if (currentRoom) {
        socket.emit('typing_start', { roomId: currentRoom });
    } else if (currentDMRecipientId) {
        socket.emit('typing_start', { recipientId: currentDMRecipientId });
    }

    typingTimeout = setTimeout(() => {
        if (currentRoom) {
            socket.emit('typing_stop', { roomId: currentRoom });
        } else if (currentDMRecipientId) {
            socket.emit('typing_stop', { recipientId: currentDMRecipientId });
        }
    }, 1000);
}

function handleUserTyping(data) {
    const { username, roomId, recipientId } = data;

    if ((roomId && roomId === currentRoom) || (recipientId && recipientId === currentUser.id)) {
        showTypingIndicator(username);
    }
}

function handleUserStoppedTyping(data) {
    hideTypingIndicator();
}

function showTypingIndicator(username) {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.textContent = `${username} is typing...`;
        typingIndicator.style.display = 'block';

        setTimeout(() => {
            hideTypingIndicator();
        }, 3000);
    }
}

function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.style.display = 'none';
    }
}

// Create room
async function createRoom(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const roomData = {
        name: formData.get('name').trim(),
        display_name: formData.get('display_name').trim(),
        description: formData.get('description').trim() || null,
        is_private: formData.get('is_private') === 'on'
    };

    try {
        const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(roomData)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('create-room-modal').style.display = 'none';
            event.target.reset();
            showNotification('Channel created successfully!', 'success');

            socket.emit('get_user_rooms');
        } else {
            showNotification(data.error || 'Failed to create channel', 'error');
        }
    } catch (error) {
        console.error('Create room error:', error);
        showNotification('Network error. Please try again.', 'error');
    }
}

// Utility functions
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        z-index: 1000;
        max-width: 300px;
        word-wrap: break-word;
    `;

    switch (type) {
        case 'success':
            notification.style.backgroundColor = '#27ae60';
            break;
        case 'error':
            notification.style.backgroundColor = '#e74c3c';
            break;
        case 'warning':
            notification.style.backgroundColor = '#f39c12';
            break;
        default:
            notification.style.backgroundColor = '#3498db';
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Make friend management functions available globally for inline onclick handlers
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.rejectFriendRequest = rejectFriendRequest;
window.cancelFriendRequest = cancelFriendRequest;
window.removeFriend = removeFriend;

// Make functions available globally for debugging
window.testDM = () => {
    console.log('🧪 Testing DM functionality');
    console.log('Current state:', {
        currentUser,
        currentRoom,
        currentDMRecipient,
        currentDMRecipientId,
        currentConversationId,
        friends: Array.from(friends.keys()),
        roomUsers: Array.from(roomUsers.keys())
    });
};

window.loadFriends = loadFriends;
window.loadDMConversations = loadDMConversations;
window.startDM = startDM;