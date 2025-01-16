const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { readToken, loadProxies, headers } = require("../utils/file");
const { logger } = require("../utils/logger");
const { withTokenRefresh } = require("../utils/token");
const fs = require('fs').promises;
const { DATA_PATHS, TIME_INTERVALS } = require('../config');

const HEARTBEAT_INTERVAL = TIME_INTERVALS.HEARTBEAT_INTERVAL;
const NODE_TEST_INTERVAL = TIME_INTERVALS.NODE_TEST_INTERVAL;

// 新增：保存points到本地文件
async function savePoints(username, points, timestamp = Date.now()) {
    try {
        let pointsData = [];
        try {
            const fileData = await fs.readFile(DATA_PATHS.POINTS_FILE, 'utf8');
            pointsData = JSON.parse(fileData);
        } catch (error) {
            // 如果文件不存在或解析失败，使用空数组
            pointsData = [];
        }

        // 更新或添加新的points记录
        const existingIndex = pointsData.findIndex(p => p.username === username);
        const pointsRecord = {
            username,
            points,
            timestamp,
            lastUpdated: new Date().toISOString()
        };

        if (existingIndex >= 0) {
            pointsData[existingIndex] = pointsRecord;
        } else {
            pointsData.push(pointsRecord);
        }

        // 保存到文件
        await fs.writeFile(DATA_PATHS.POINTS_FILE, JSON.stringify(pointsData, null, 2));
        logger(`Points saved for ${username}: ${points}`, 'info');
    } catch (error) {
        logger(`Error saving points for ${username}: ${error.message}`, 'error');
    }
}

// Fetch points for a user
async function fetchPoints(token, username, agent, API_BASE) {
    try {
        const response = await fetch(`${API_BASE}/api/points`, {
            headers: {
                ...headers,
                "content-type": "application/json",
                "authorization": `Bearer ${token}`,
            },
            agent,
        });

        if (response.ok) {
            const data = await response.json();
            logger(`Current Points for ${username}: ${data.points}`, "info");
            
            // 保存points到本地
            await savePoints(username, data.points);
            
            return data.points;
        } else {
            logger(`Failed to fetch points for ${username}: Status ${response.status}`, "error");
            return null;
        }
    } catch (error) {
        logger(`Error fetching points for ${username}: ${error.message}`, "error");
        return null;
    }
}

// 保存运行时间记录
async function saveRunTimes(username, type, timestamp = Date.now()) {
    try {
        logger(`开始保存运行时间 - ${username} - ${type}`, 'info');
        
        // 读取现有数据
        let timeData = [];
        try {
            const fileData = await fs.readFile(DATA_PATHS.RUNTIME_FILE, 'utf8');
            timeData = JSON.parse(fileData);
        } catch (error) {
            logger(`读取运行时间文件失败: ${error.message}, 将创建新文件`, 'warn');
            timeData = [];
        }

        // 计算时间
        const nextRun = type === 'heartbeat' ? 
            timestamp + HEARTBEAT_INTERVAL :
            timestamp + NODE_TEST_INTERVAL;

        // 更新记录
        const existingIndex = timeData.findIndex(p => p.username === username);
        const timeRecord = {
            username,
            ...(existingIndex >= 0 ? timeData[existingIndex] : {
                lastHeartbeat: null,
                nextHeartbeat: null,
                lastNodeTest: null,
                nextNodeTest: null
            })
        };

        if (type === 'heartbeat') {
            timeRecord.lastHeartbeat = timestamp;
            timeRecord.nextHeartbeat = nextRun;
        } else {
            timeRecord.lastNodeTest = timestamp;
            timeRecord.nextNodeTest = nextRun;
        }

        // 更新数组
        if (existingIndex >= 0) {
            timeData[existingIndex] = timeRecord;
        } else {
            timeData.push(timeRecord);
        }

        // 保存数据
        const recordToSave = JSON.stringify(timeData, null, 2);
        await fs.writeFile(DATA_PATHS.RUNTIME_FILE, recordToSave, 'utf8');

        logger(`成功保存运行时间 - ${username}:
        - 类型: ${type}
        - 当前时间戳: ${timestamp}
        - 下次运行时间戳: ${nextRun}`, 'success');

    } catch (error) {
        logger(`保存运行时间失败 - ${username}: ${error.message}`, 'error');
        logger(`错误堆栈: ${error.stack}`, 'debug');
        throw error;
    }
}

// 检查是否需要运行
async function shouldRun(username, type) {
    try {
        logger(`检查${username}是否需要运行${type}`, 'info');
        
        const fileData = await fs.readFile(DATA_PATHS.RUNTIME_FILE, 'utf8');
        const timeData = JSON.parse(fileData);
        logger(`成功读取运行时间记录，共${timeData.length}条记录`, 'info');
        
        const record = timeData.find(p => p.username === username);
        if (!record) {
            logger(`未找到${username}的运行记录，允许运行`, 'info');
            return true;
        }

        const now = Date.now();
        if (type === 'heartbeat') {
            const shouldExecute = !record.nextHeartbeat || now >= record.nextHeartbeat;
            const timeLeft = record.nextHeartbeat ? Math.max(0, record.nextHeartbeat - now) : 0;
            
            logger(`${username}的心跳检查:
            - 当前时间戳: ${now}
            - 下次运行时间戳: ${record.nextHeartbeat || 'null'}
            - 剩余时间: ${Math.floor(timeLeft / 1000)}秒
            - 是否运行: ${shouldExecute ? '是' : '否'}`, 'info');
            
            return shouldExecute;
        } else {
            const shouldExecute = !record.nextNodeTest || now >= record.nextNodeTest;
            const timeLeft = record.nextNodeTest ? Math.max(0, record.nextNodeTest - now) : 0;
            
            logger(`${username}的节点测试检查:
            - 当前时间戳: ${now}
            - 下次运行时间戳: ${record.nextNodeTest || 'null'}
            - 剩余时间: ${Math.floor(timeLeft / 1000)}秒
            - 是否运行: ${shouldExecute ? '是' : '否'}`, 'info');
            
            return shouldExecute;
        }
    } catch (error) {
        logger(`检查${username}运行时间时出错: ${error.message}，默认允许运行`, 'warn');
        return true;
    }
}

// 修改 sendHeartbeat 函数，在成功时保存运行时间
async function sendHeartbeat(API_BASE) {
    const proxies = await loadProxies();
    if (proxies.length === 0) {
        logger("No proxies available. Please check your proxy.txt file.", "error");
        return;
    }

    const tokens = await readToken();
    if (!tokens.length) {
        logger("No tokens found. Please check your token.txt file.", "error");
        return;
    }

    for (let i = 0; i < tokens.length; i++) {
        const { token, username } = tokens[i];
        
        // 添加检查
        if (!await shouldRun(username, 'heartbeat')) {
            logger(`Skipping heartbeat for ${username} - Too soon since last run`, 'info');
            continue;
        }

        const proxy = proxies[i % proxies.length];
        const agent = new HttpsProxyAgent(proxy);

        try {
            await withTokenRefresh(async (currentToken) => {
                const geoInfo = await getGeoLocation(agent);
                logger(`Geo-location data: ${geoInfo.ip}, ${geoInfo.location}`, "info");
                
                const response = await fetch(`${API_BASE}/api/heartbeat`, {
                    method: "POST",
                    headers: {
                        ...headers,
                        "content-type": "application/json",
                        "authorization": `Bearer ${currentToken}`,
                    },
                    body: JSON.stringify({
                        ip: geoInfo.ip,
                        location: geoInfo.location,
                        timestamp: Date.now(),
                    }),
                    agent,
                });

                if (response.ok) {
                    await saveRunTimes(username, 'heartbeat');
                    logger(`Heartbeat sent successfully for ${username}`, "success");
                    await fetchPoints(currentToken, username, agent, API_BASE);
                } else {
                    const errorText = await response.text();
                    logger(`Failed to send heartbeat for ${username}: ${errorText}`, "error");
                    throw { status: response.status, message: errorText };
                }
            }, username, token, API_BASE, proxy);
        } catch (error) {
            logger(`Error sending heartbeat for ${username}: ${error.message}`, "error");
        }
    }
}

// Fetch IP and Geo-location data
async function getGeoLocation(agent) {
    try {
        const response = await fetch('https://ipwhois.app/json/', { agent });
        if (!response.ok) throw new Error(`Geo-location request failed with status ${response.status}`);
        const data = await response.json();
        return {
            ip: data.ip,
            location: `${data.city}, ${data.region}, ${data.country}`,
        };
    } catch (error) {
        logger(`Geo-location error: ${error.message}`, "error");
        return { ip: "0.0.0.0", location: "Unknown Location" };
    }
}

// Function to check for rewards and notify the user
async function checkForRewards(baseUrl, token) {

    try {
        const response = await fetch(`${baseUrl}/api/rewards`, {
            headers: {
                ...headers,
                "content-type": "application/json",
                "authorization": `Bearer ${token}`,
            }, 
            agent,
        });

        if (response.ok) {
            const data = await response.json();
            if (Object.keys(data).length > 0) {
                logger(`Earn more rewards points! Visit: ${data.link}`, 'info', data.link);
            } else {
                logger("No rewards available at the moment.");
            }
        } else {
            logger("Failed to fetch rewards data.", 'warn');
        }
    } catch (error) {
        const errorMessage = error.code || error.message.split('\n')[0];
        logger(`Error checking for rewards: ${errorMessage}`, 'error');
    }
}

module.exports = { 
    sendHeartbeat, 
    checkForRewards,
    shouldRun,
    saveRunTimes 
};
