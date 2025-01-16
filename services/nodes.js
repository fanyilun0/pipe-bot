const fetch = require("node-fetch");
const { readToken, loadProxies, headers } = require("../utils/file");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { logger } = require("../utils/logger");
const { withTokenRefresh } = require("../utils/token");


// Function to fetch the base URL
async function fetchBaseUrl(fallbackUrl) {
    logger('Fetching base URL...');

    try {
        const response = await fetchWithRetry('https://pipe-network-backend.pipecanary.workers.dev/api/getBaseUrl');
        if (!response.ok) throw new Error(`Failed to fetch base URL with status ${response.status}`);
        const data = await response.json();
        logger('Fetched base URL successfully:', 'info', data.baseUrl);
        return data.baseUrl;
    } catch (error) {
        logger('Failed to fetch base URL:', 'error', error.message);
        return fallbackUrl;
    }
}

// Function to fetch a URL with retry logic
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
    logger(`Fetching URL with retry logic: ${url}`);
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
            logger(`Request to ${url} succeeded on attempt ${attempt + 1}`);
            return response;
        } catch (error) {
            logger(`Attempt ${attempt + 1} failed for ${url}:`, 'warn', error.message);
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    logger('All retry attempts failed for URL:', 'error', url);
    throw new Error('All retry attempts failed');
}

// Main function to run node tests
async function runNodeTests(API_BASE) {
    const proxies = await loadProxies();
    if (proxies.length === 0) {
        logger("No proxies available. Please check your proxy.txt file.", "error");
        return;
    }

    try {
        const tokens = await readToken();
        if (tokens.length === 0) {
            logger("No tokens available. Please check your token.txt file.", "error");
            return;
        }

        for (let j = 0; j < tokens.length; j++) {
            const { token, username } = tokens[j];
            const proxy = proxies[j % proxies.length];
            const agent = new HttpsProxyAgent(proxy);

            logger(`Fetching nodes for ${username} using proxy: ${proxy}`, "info");

            const response = await fetch(`${API_BASE}/api/nodes`, {
                headers: {
                    ...headers,
                    "authorization": `Bearer ${token}`,
                },
                agent,
            });

            if (!response.ok) throw new Error(`Failed to fetch nodes with status ${response.status}`);
            const nodes = await response.json();

            for (const node of nodes) {
                logger(`Testing node ${node.node_id}  (${node.ip}) using proxy: ${proxy}`, "info");
                const latency = await testNodeLatency(node, agent);

                logger(`Node ${node.node_id} (${node.ip}) latency: ${latency}ms`, latency > 0 ? "success" : "warn");
                await reportTestResult(node, latency, token, agent, username, API_BASE);
            }
        }

        logger("All node tests completed! Results sent to backend.", "success");
    } catch (error) {
        logger(`Error running node tests: ${error.message}`, "error");
    }
}

// Function to test node latency
async function testNodeLatency(node, agent) {
    const start = Date.now();
    const timeout = 5000;

    try {
        await Promise.race([
            fetch(`http://${node.ip}`, { agent, mode: "no-cors" }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
        ]);
        return Date.now() - start;
    } catch (error) {
        logger(`Latency test failed for node ${node.node_id}: ${error.message}`, "warn");
        return -1;
    }
}

// Function to report test result
async function reportTestResult(node, latency, token, agent, username, API_BASE, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await withTokenRefresh(async (currentToken) => {
                const response = await fetch(`${API_BASE}/api/nodes/${node.node_id}/test`, {
                    method: "POST",
                    headers: {
                        ...headers,
                        "authorization": `Bearer ${currentToken}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ latency }),
                    agent,
                });

                if (response.ok) {
                    logger(`Successfully reported node id:${node.node_id} ip:${node.ip} test result for ${username}`, "success");
                    return;
                }

                if (response.status === 504) {
                    logger(`Gateway timeout when reporting node id:${node.node_id} ip:${node.ip}, attempt ${i + 1}/${retries}`, "warn");
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                    throw { status: 504 };
                }

                const errorText = await response.text();
                throw { status: response.status, message: errorText };
            }, username, token, API_BASE, agent);
            
            break;
        } catch (error) {
            if (error.status === 504 && i < retries - 1) {
                continue;
            }
            if (i === retries - 1) {
                const errorMessage = error.code || error.message || `Status ${error.status}`;
                logger(`Failed to report node id:${node.node_id} ip:${node.ip} for ${username}: ${errorMessage}`, "error");
            }
        }
    }
}

module.exports = { runNodeTests, fetchBaseUrl };
