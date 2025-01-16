const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { DATA_PATHS } = require('../config');

// 确保日志目录存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 创建当前日期的日志文件
const getLogFile = () => {
    const date = new Date().toISOString().split('T')[0];
    return path.join(logDir, `${date}.log`);
};

function logger(message, level = 'info', value = "") {
    const now = new Date().toISOString();
    const colors = {
        info: chalk.green,
        warn: chalk.yellow,
        error: chalk.red,
        success: chalk.blue,
        debug: chalk.magenta,
    };
    const color = colors[level] || chalk.white;
    
    // 控制台输出（带颜色）
    console.log(color(`[${now}] [${level.toUpperCase()}]: ${message}`), chalk.yellow(value));
    
    // 写入文件（不带颜色）
    const logMessage = `[${now}] [${level.toUpperCase()}]: ${message} ${value}\n`;
    fs.appendFileSync(getLogFile(), logMessage);
}

module.exports = { logger };
