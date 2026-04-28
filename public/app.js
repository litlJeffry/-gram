// Проверка авторизации
const savedUser = JSON.parse(localStorage.getItem('tacogram_user'));
if (!savedUser && !window.location.pathname.includes('index.html')) {
    window.location.href = '/';
}

let currentUser = savedUser;
let socket;
let selectedUserId = null;
let typingTimeout;

// Инициализация
if (currentUser) {
    initApp();
}

function initApp() {
    // Подключение к серверу
    socket = io();

    socket.on('connect', () => {
        console.log('🔌 Подключено к серверу');
        socket.emit('login', currentUser.id);
    });

    // Отображаем информацию о пользователе
    document.getElementById('currentUserAvatar').textContent = currentUser.avatar;
    document.getElementById('currentUserName').textContent = currentUser.username;
    document.getElementById('currentUserId').textContent = `ID: ${currentUser.id}`;
    document.getElementById('myIdDisplay').textContent = currentUser.id;

    // Загружаем список пользователей
    loadUsers();

    // Слушатели событий
    socket.on('newMessage', handleNewMessage);
    socket.on('messageSent', handleMessageSent);
    socket.on('userTyping', handleUserTyping);
    socket.on('userStopTyping', handleUserStopTyping);
    socket.on('userOnline', handleUserStatus);
    socket.on('userOffline', handleUserStatus);
    socket.on('messagesRead', handleMessagesRead);
}

async function loadUsers() {
    try {
        const response = await fetch(`/api/users?userId=${currentUser.id}`);
        const users = await response.json();
        renderUsersList(users);
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

function renderUsersList(users) {
    const usersList = document.getElementById('usersList');
    
    if (users.length === 0) {
        usersList.innerHTML = `
            <div style="text-align:center; padding: 60px 20px; color: #888;">
                <div style="font-size: 60px;">👥</div>
                <h3>Нет других пользователей</h3>
                <p>Поделитесь своим ID ${currentUser.id} с друзьями!</p>
            </div>
        `;
        return;
    }

    usersList.innerHTML = users.map(user => `
        <div class="user-item ${selectedUserId === user.id ? 'active' : ''}" onclick="selectUser(${user.id})">
            <div class="user-item-avatar">
                ${user.avatar}
                ${user.online ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="user-item-info">
                <div class="user-item-name">${user.username}</div>
                <div class="user-item-last">ID: ${user.id} ${user.online ? '🟢 Онлайн' : '⚫ Офлайн'}</div>
            </div>
        </div>
    `).join('');
}

async function selectUser(userId) {
    selectedUserId = userId;
    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatActive').style.display = 'flex';
    
    // Загружаем информацию о пользователе
    try {
        const response = await fetch(`/api/users/${userId}`);
        const user = await response.json();
        
        document.getElementById('chatAvatar').textContent = user.avatar;
        document.getElementById('chatName').textContent = user.username;
        document.getElementById('chatStatus').textContent = user.online ? '🟢 Онлайн' : '⚫ Офлайн';
        document.getElementById('chatStatus').className = `chat-user-status ${user.online ? '' : 'offline'}`;
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
    }

    // Загружаем историю сообщений
    loadMessages(userId);
    
    // Обновляем список пользователей
    loadUsers();

    // На мобильных устройствах показываем чат
    if (window.innerWidth <= 768) {
        document.getElementById('chatActive').classList.add('open');
    }
}

async function loadMessages(userId) {
    try {
        const response = await fetch(`/api/messages/${currentUser.id}/${userId}`);
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

function renderMessages(messages) {
    const messagesList = document.getElementById('messagesList');
    
    if (messages.length === 0) {
        messagesList.innerHTML = `
            <div style="text-align:center; padding: 40px; color: #888;">
                Напишите первое сообщение! 👋
            </div>
        `;
        return;
    }

    messagesList.innerHTML = messages.map(msg => {
        const isSent = msg.senderId === currentUser.id;
        return `
            <div class="message ${isSent ? 'sent' : 'received'}">
                ${msg.text ? `<div>${escapeHtml(msg.text)}</div>` : ''}
                ${msg.imageUrl ? `<img src="${msg.imageUrl}" alt="Изображение" loading="lazy">` : ''}
                <div class="message-time">
                    ${formatTime(msg.timestamp)}
                    ${isSent ? `<span>${msg.read ? '✓✓' : '✓'}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    scrollToBottom();
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !selectedUserId) return;

    const messageData = {
        senderId: currentUser.id,
        receiverId: selectedUserId,
        text: text,
        imageUrl: null
    };

    socket.emit('sendMessage', messageData);
    input.value = '';
    input.focus();
}

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file || !selectedUserId) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            const messageData = {
                senderId: currentUser.id,
                receiverId: selectedUserId,
                text: '',
                imageUrl: data.imageUrl
            };
            socket.emit('sendMessage', messageData);
        }
    } catch (error) {
        showNotification('Ошибка загрузки изображения');
    }

    event.target.value = '';
}

function handleNewMessage(message) {
    if (message.senderId === selectedUserId) {
        loadMessages(selectedUserId);
        // Отмечаем как прочитанное
        socket.emit('markRead', {
            senderId: message.senderId,
            receiverId: currentUser.id
        });
    } else {
        showNotification('Новое сообщение!');
    }
    loadUsers(); // Обновляем список
}

function handleMessageSent(message) {
    if (message.receiverId === selectedUserId) {
        loadMessages(selectedUserId);
    }
    loadUsers();
}

function handleKeyDown(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
    
    // Индикатор печати
    if (selectedUserId) {
        socket.emit('typing', {
            senderId: currentUser.id,
            receiverId: selectedUserId
        });
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stopTyping', {
                senderId: currentUser.id,
                receiverId: selectedUserId
            });
        }, 2000);
    }
}

function handleUserTyping(data) {
    if (data.userId === selectedUserId) {
        document.getElementById('typingIndicator').style.display = 'block';
    }
}

function handleUserStopTyping(data) {
    if (data.userId === selectedUserId) {
        document.getElementById('typingIndicator').style.display = 'none';
    }
}

function handleUserStatus(data) {
    loadUsers();
}

function handleMessagesRead(data) {
    if (selectedUserId === data.byUserId) {
        loadMessages(selectedUserId);
    }
}

function closeChat() {
    selectedUserId = null;
    document.getElementById('chatPlaceholder').style.display = 'flex';
    document.getElementById('chatActive').style.display = 'none';
    loadUsers();
}

function deleteChat() {
    if (confirm('Удалить переписку?')) {
        // Здесь можно добавить API для удаления сообщений
        if (selectedUserId) {
            loadMessages(selectedUserId);
        }
    }
}

function filterUsers() {
    const searchTerm = document.getElementById('searchUsers').value.toLowerCase();
    loadUsers().then(() => {
        const items = document.querySelectorAll('.user-item');
        items.forEach(item => {
            const name = item.querySelector('.user-item-name').textContent.toLowerCase();
            item.style.display = name.includes(searchTerm) ? 'flex' : 'none';
        });
    });
}

function shareId() {
    const id = currentUser.id;
    navigator.clipboard.writeText(`Привет! Мой ID в 🌮gram: ${id}`).then(() => {
        showNotification('ID скопирован в буфер обмена!');
    });
}

function logout() {
    localStorage.removeItem('tacogram_user');
    window.location.href = '/';
}

function showNotification(message) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Утилиты
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.querySelector('.messages-container');
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

// Обработка ресайза для мобильных
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        document.getElementById('chatActive').classList.remove('open');
    }
});
