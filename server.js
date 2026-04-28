const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Создаем папку для загрузок если её нет
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Настройка multer для загрузки изображений
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|bmp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Только изображения (jpg, png, gif, webp, bmp)'));
    }
});

// Хранилище данных (в реальном проекте - база данных)
let users = [];
let messages = [];
let groups = [];
let userIdCounter = 1;

// Загрузка данных из файлов (простое сохранение)
const DATA_FILE = 'tacogram_data.json';

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            users = data.users || [];
            messages = data.messages || [];
            groups = data.groups || [];
            userIdCounter = data.userIdCounter || 1;
            console.log('✅ Данные загружены');
        }
    } catch (error) {
        console.log('📝 Создана новая база данных');
    }
}

function saveData() {
    const data = { users, messages, groups, userIdCounter };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

loadData();

// Отслеживание онлайн пользователей
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId

// API endpoints
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
    }

    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 20 символов' });
    }

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const newUser = {
        id: userIdCounter++,
        username: username,
        password: password, // В реальном проекте нужно хешировать!
        avatar: getRandomAvatar(),
        bio: '',
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveData();

    res.json({
        success: true,
        user: {
            id: newUser.id,
            username: newUser.username,
            avatar: newUser.avatar
        }
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }

    user.lastSeen = new Date().toISOString();
    saveData();

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio
        }
    });
});

app.get('/api/users', (req, res) => {
    const { userId } = req.query;
    const usersList = users
        .filter(u => u.id !== parseInt(userId))
        .map(u => ({
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            bio: u.bio,
            lastSeen: u.lastSeen,
            online: onlineUsers.has(u.id)
        }));
    res.json(usersList);
});

app.get('/api/users/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        online: onlineUsers.has(user.id)
    });
});

app.get('/api/messages/:userId1/:userId2', (req, res) => {
    const id1 = parseInt(req.params.userId1);
    const id2 = parseInt(req.params.userId2);
    
    const chatMessages = messages.filter(m => 
        (m.senderId === id1 && m.receiverId === id2) ||
        (m.senderId === id2 && m.receiverId === id1)
    ).sort((a, b) => a.timestamp - b.timestamp);

    res.json(chatMessages);
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
});

// WebSocket обработка
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение:', socket.id);
    let currentUserId = null;

    socket.on('login', (userId) => {
        currentUserId = userId;
        onlineUsers.set(socket.id, userId);
        userSockets.set(userId, socket.id);
        
        // Обновляем статус пользователя
        const user = users.find(u => u.id === userId);
        if (user) {
            user.lastSeen = new Date().toISOString();
            saveData();
        }
        
        io.emit('userOnline', userId);
        console.log(`👤 Пользователь ${userId} онлайн`);
    });

    socket.on('sendMessage', (data) => {
        const { senderId, receiverId, text, imageUrl } = data;
        
        const newMessage = {
            id: messages.length + 1,
            senderId,
            receiverId,
            text: text || '',
            imageUrl: imageUrl || null,
            timestamp: new Date().toISOString(),
            read: false
        };

        messages.push(newMessage);
        saveData();

        // Отправляем получателю
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('newMessage', newMessage);
        }

        // Отправляем подтверждение отправителю
        socket.emit('messageSent', newMessage);
    });

    socket.on('markRead', (data) => {
        const { senderId, receiverId } = data;
        messages
            .filter(m => m.senderId === senderId && m.receiverId === receiverId && !m.read)
            .forEach(m => m.read = true);
        saveData();
        
        const senderSocketId = userSockets.get(senderId);
        if (senderSocketId) {
            io.to(senderSocketId).emit('messagesRead', { byUserId: receiverId });
        }
    });

    socket.on('typing', (data) => {
        const { senderId, receiverId } = data;
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('userTyping', { userId: senderId });
        }
    });

    socket.on('stopTyping', (data) => {
        const { senderId, receiverId } = data;
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('userStopTyping', { userId: senderId });
        }
    });

    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(socket.id);
            userSockets.delete(currentUserId);
            
            const user = users.find(u => u.id === currentUserId);
            if (user) {
                user.lastSeen = new Date().toISOString();
                saveData();
            }
            
            io.emit('userOffline', currentUserId);
            console.log(`👋 Пользователь ${currentUserId} офлайн`);
        }
    });
});

// Генерация случайного аватара
function getRandomAvatar() {
    const avatars = ['👤', '👩', '👨', '👩‍🦰', '👨‍🦱', '👩‍🦳', '👨‍🦳', '👩‍🦲', '👨‍🦲', '👱‍♀️', '👱‍♂️', '🧔', '👸', '🤴', '🦸‍♀️', '🦸‍♂️'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║           🌮gram Мессенджер             ║
╠══════════════════════════════════════════╣
║  Сервер запущен на порту: ${PORT}         ║
║  Откройте: http://localhost:${PORT}      ║
║                                          ║
║  Возможности:                            ║
║  ✅ Регистрация и авторизация            ║
║  ✅ Уникальные ID пользователей          ║
║  ✅ Обмен сообщениями в реальном времени ║
║  ✅ Отправка изображений                 ║
║  ✅ Статусы онлайн/офлайн               ║
║  ✅ Индикатор печати                     ║
║  ✅ Сохранение истории                   ║
╚══════════════════════════════════════════╝
    `);
});
