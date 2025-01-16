const fetch = require("node-fetch");
const {  headers, loadProxies } = require("../utils/file");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { logger } = require("../utils/logger");
const fs = require('fs');
const { saveToken, verifyToken, getExistingToken } = require("../utils/token");
const { CONFIG_PATHS } = require('../config');

// Add delay utility function at the top
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to read all accounts from account.json
async function readUsersFromFile() {
    try {
        const fileData = await fs.promises.readFile(CONFIG_PATHS.ACCOUNT_FILE, 'utf8');
        return fileData
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [email, password] = line.split(':').map(s => s.trim());
                return { email, password };
            });
    } catch (error) {
        logger('Error reading users from file', 'error', error);
        return [];
    }
}

// 修改：登录函数，增加详细日志
async function login(email, password, API_BASE, proxy) {
    try {
        // 检查现有token
        logger(`Checking existing token for ${email}...`, 'info');
        const existingToken = await getExistingToken(email);
        
        if (existingToken) {
            logger(`Found existing token for ${email}, verifying...`, 'info');
            const isValid = await verifyToken(existingToken, API_BASE);
            
            if (isValid) {
                logger(`Existing token for ${email} is valid, using it`, 'success');
                return {
                    success: true,
                    token: existingToken,
                    isNewLogin: false
                };
            }
            logger(`Existing token for ${email} is invalid, proceeding with new login`, 'warn');
        } else {
            logger(`No existing token found for ${email}, proceeding with new login`, 'info');
        }

        // Add random delay before login request
        const delayMs = Math.floor(Math.random() * 4000) + 1000; // 1-5 seconds
        logger(`Adding ${delayMs}ms delay before login request for ${email}...`, 'info');
        await delay(delayMs);

        // 执行新登录
        logger(`Attempting new login for ${email}...`, 'info');
        const agent = new HttpsProxyAgent(proxy);
        const response = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: {
                ...headers,
                "content-type": "application/json",
            },
            body: JSON.stringify({ email, password }),
            agent,
        });

        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                logger(`New token received for ${email}`, 'info');
                await saveToken({ token: data.token, username: email });
                logger(`New login successful for ${email}!`, 'success');
                return {
                    success: true,
                    token: data.token,
                    isNewLogin: true
                };
            }
            logger(`Login failed for ${email}: No token returned`, 'error');
            return {
                success: false,
                error: 'No token returned'
            };
        }

        const errorText = await response.text();
        logger(`Login failed for ${email}: ${errorText}`, 'error');
        return {
            success: false,
            error: errorText
        };

    } catch (error) {
        logger(`Error during login process for ${email}:`, 'error', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 修改：处理所有账号的登录，增加详细日志
async function loginWithAllAccounts(API_BASE) {
    logger('Starting login process for all accounts...', 'info');
    
    const proxies = await loadProxies();
    if (proxies.length === 0) {
        logger("No proxies available. Please check your proxy.txt file.", "error");
        return;
    }
    logger(`Loaded ${proxies.length} proxies`, 'info');

    const accounts = await readUsersFromFile();
    if (accounts.length === 0) {
        logger("No accounts found. Please check your accounts.txt file.", "error");
        return;
    }
    logger(`Found ${accounts.length} accounts to process`, 'info');

    const results = {
        total: accounts.length,
        validTokens: 0,
        newLogins: 0,
        failed: 0,
        failedAccounts: []
    };

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const proxy = proxies[i % proxies.length];
        
        logger(`Processing account ${i + 1}/${accounts.length}: ${account.email}`, 'info');
        const loginResult = await login(account.email, account.password, API_BASE, proxy);

        if (loginResult.success) {
            if (loginResult.isNewLogin) {
                results.newLogins++;
                logger(`New login successful for ${account.email}`, 'success');
            } else {
                results.validTokens++;
                logger(`Using existing valid token for ${account.email}`, 'success');
            }
        } else {
            results.failed++;
            results.failedAccounts.push({
                email: account.email,
                error: loginResult.error
            });
            logger(`Failed to process ${account.email}: ${loginResult.error}`, 'error');
        }
    }

    logger(`Login process completed:
    - Total accounts: ${results.total}
    - Using existing valid tokens: ${results.validTokens}
    - New successful logins: ${results.newLogins}
    - Failed attempts: ${results.failed}
    - Failed accounts:
      ${results.failedAccounts.map(acc => `
      * ${acc.email} - Error: ${acc.error}`).join('')}`, 'info');
}

module.exports = { login, loginWithAllAccounts };
