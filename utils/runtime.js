const fs = require('fs').promises;
const { DATA_PATHS } = require('../config');
const { logger } = require('./logger');
const { HEARTBEAT_INTERVAL, NODE_TEST_INTERVAL } = require('../config');

// 运行时间记录的数据结构
class RuntimeRecord {
    constructor(username) {
        this.username = username;
        this.lastHeartbeat = null;
        this.nextHeartbeat = null;
        this.lastNodeTest = null;
        this.nextNodeTest = null;
    }
}

// 保存运行时间记录
async function saveRunTimes(username, type, timestamp = Date.now()) {
    try {
        let timeData = [];
        try {
            const fileData = await fs.readFile(DATA_PATHS.RUNTIME_FILE, 'utf8');
            timeData = JSON.parse(fileData);
        } catch (error) {
            timeData = [];
        }

        const existingIndex = timeData.findIndex(p => p.username === username);
        const nextRun = type === 'heartbeat' ? 
            timestamp + HEARTBEAT_INTERVAL :
            timestamp + NODE_TEST_INTERVAL;

        const timeRecord = existingIndex >= 0 ? 
            timeData[existingIndex] : 
            new RuntimeRecord(username);

        if (type === 'heartbeat') {
            timeRecord.lastHeartbeat = timestamp;
            timeRecord.nextHeartbeat = nextRun;
        } else {
            timeRecord.lastNodeTest = timestamp;
            timeRecord.nextNodeTest = nextRun;
        }

        if (existingIndex >= 0) {
            timeData[existingIndex] = timeRecord;
        } else {
            timeData.push(timeRecord);
        }

        await fs.writeFile(DATA_PATHS.RUNTIME_FILE, JSON.stringify(timeData, null, 2));
        logger(`Runtime saved for ${username} - ${type}`, 'info');
    } catch (error) {
        logger(`Error saving runtime for ${username}: ${error.message}`, 'error');
        throw error;
    }
}

// 检查是否需要运行
async function shouldRun(username, type) {
    try {
        const fileData = await fs.readFile(DATA_PATHS.RUNTIME_FILE, 'utf8');
        const timeData = JSON.parse(fileData);
        
        const record = timeData.find(p => p.username === username);
        if (!record) return true;

        const now = Date.now();
        if (type === 'heartbeat') {
            return !record.nextHeartbeat || now >= record.nextHeartbeat;
        } else {
            return !record.nextNodeTest || now >= record.nextNodeTest;
        }
    } catch (error) {
        logger(`Error checking runtime for ${username}: ${error.message}`, 'error');
        return true; // 如果文件不存在或出错,默认允许运行
    }
}

// 获取下次运行时间
async function getNextRunTime(username, type) {
    try {
        const fileData = await fs.readFile(DATA_PATHS.RUNTIME_FILE, 'utf8');
        const timeData = JSON.parse(fileData);
        
        const record = timeData.find(p => p.username === username);
        if (!record) return null;

        return type === 'heartbeat' ? record.nextHeartbeat : record.nextNodeTest;
    } catch (error) {
        logger(`Error getting next runtime for ${username}: ${error.message}`, 'error');
        return null;
    }
}

module.exports = {
    saveRunTimes,
    shouldRun,
    getNextRunTime
}; 