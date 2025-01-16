const fetch = require('node-fetch');
const fs = require('fs').promises;
const { HttpsProxyAgent } = require('https-proxy-agent');
const { logger } = require('./logger');
const { headers } = require('./file');
const { DATA_PATHS, CONFIG_PATHS } = require('../config');

const TOKEN_FILE = DATA_PATHS.TOKENS_FILE;
const ACCOUNT_FILE = CONFIG_PATHS.ACCOUNTS_FILE;

// 读取账号信息
async function readAccountCredentials() {
    try {
        const fileData = await fs.readFile(ACCOUNT_FILE, 'utf8');
        return fileData
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [email, password] = line.split(':').map(s => s.trim());
                return { email, password };
            });
    } catch (error) {
        logger('Error reading account credentials:', 'error', error);
        return [];
    }
}

// 验证token
async function verifyToken(token, API_BASE) {
    try {
        const response = await fetch(`${API_BASE}/api/points`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                ...headers
            }
        });
        return response.status === 200;
    } catch (error) {
        logger('Error verifying token:', 'error', error);
        return false;
    }
}

// 获取已存token
async function getExistingToken(username) {
    try {
        const fileData = await fs.readFile(TOKEN_FILE, 'utf8');
        const tokens = JSON.parse(fileData);
        const tokenData = tokens.find(t => t.username === username);
        return tokenData?.token;
    } catch (error) {
        return null;
    }
}

// 直接在token.js中实现token刷新逻辑
async function refreshToken(username, API_BASE, proxy) {
    try {
        // 获取账号信息
        const accounts = await readAccountCredentials();
        const account = accounts.find(acc => acc.email === username);
        
        if (!account) {
            throw new Error(`No credentials found for ${username}`);
        }

        // 直接进行登录请求获取新token
        const agent = new HttpsProxyAgent(proxy);
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: {
                ...headers,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                email: account.email,
                password: account.password
            }),
            agent
        });

        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                // 保存新token
                await saveToken({ token: data.token, username });
                logger(`Token refreshed for ${username}`, 'success');
                return data.token;
            }
        }
        throw new Error(`Failed to refresh token for ${username}`);
    } catch (error) {
        logger(`Failed to refresh token for ${username}:`, 'error', error);
        throw error;
    }
}

// API调用的包装函数
async function withTokenRefresh(apiCall, username, token, API_BASE, proxy) {
    try {
        return await apiCall(token);
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            logger(`Token expired for ${username}, attempting refresh...`);
            const newToken = await refreshToken(username, API_BASE, proxy);
            if (newToken) {
                return await apiCall(newToken);
            }
        }
        throw error;
    }
}

module.exports = {
    verifyToken,
    getExistingToken,
    refreshToken,
    withTokenRefresh
}; 