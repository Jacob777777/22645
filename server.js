const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');

const app = express();
const port = process.env.PORT || 3000;

// 配置文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads';
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// 清理文件函數
async function cleanupUploads() {
    try {
        const uploadDir = 'public/uploads';
        const files = await fsPromises.readdir(uploadDir);
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(uploadDir, file);
            const stats = await fsPromises.stat(filePath);
            const fileAge = now - stats.mtime.getTime();

            if (fileAge > oneWeek) {
                await fsPromises.unlink(filePath);
                console.log(`已刪除過期文件: ${file}`);
            }
        }
        console.log('清理完成');
    } catch (error) {
        console.error('清理文件時發生錯誤:', error);
    }
}

// 設置定時任務：每週日凌晨 3 點執行清理
schedule.scheduleJob('0 3 * * 0', async () => {
    console.log('開始執行週期性清理...');
    await cleanupUploads();
});

// 也可以在服務器啟動時執行一次清理
cleanupUploads().then(() => {
    console.log('服務器啟動時清理完成');
});

// 提供靜態文件
app.use(express.static('public'));

// 处理文件上传
app.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        res.json({
            success: true,
            filename: '/uploads/' + req.file.filename
        });
    } else {
        res.status(400).json({ success: false });
    }
});

const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// 創建 WebSocket 服務器
const wss = new WebSocket.Server({ 
    server,
    // 添加 WebSocket 配置
    perMessageDeflate: false
});

// 儲存所有連接的用戶
const clients = new Map();

wss.on('connection', (ws) => {
    let userName = '';

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'join') {
            userName = data.userName;
            clients.set(ws, userName);
            
            // 廣播新用戶加入的消息
            broadcastMessage({
                type: 'system',
                content: `${userName} 已加入聊天室`
            });
        } else if (data.type === 'message') {
            // 廣播聊天消息，添加 fileType 屬性
            broadcastMessage({
                type: 'chat',
                content: data.content,
                userName: userName,
                fileType: data.fileType // 添加文件類型
            });
        }
    });

    ws.on('close', () => {
        if (userName) {
            clients.delete(ws);
            broadcastMessage({
                type: 'system',
                content: `${userName} 已離開聊天室`
            });
        }
    });
});

function broadcastMessage(message) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
} 