const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { readToken, loadProxies, headers } = require("../utils/file");
const { logger } = require("../utils/logger");
const { withTokenRefresh } = require("../utils/token");
const fs = require('fs').promises;
const { DATA_PATHS } = require('../config');

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

// Function to send heartbeat
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
                    logger(`Heartbeat sent successfully for ${username} using proxy: ${proxy}`, "success");
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

module.exports = { sendHeartbeat, checkForRewards };
