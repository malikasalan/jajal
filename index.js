import { ethers } from 'ethers';
import dotenv from 'dotenv';
import logToFile from 'log-to-file';
import fs from 'fs';
require('dotenv').config();

// ===== CONFIGURATION =====
const config = {
    RPC_URL: process.env.LENS_RPC_URL || "https://rpc.lens.xyz",
    CHAIN_ID: parseInt(process.env.LENS_CHAIN_ID || "232"),
    TOKENS: {
        USDC: process.env.TOKEN_USDC || "0x88F08E304EC4f90D644Cec3Fb69b8aD414acf884",
        WGHO: process.env.TOKEN_WGHO || "0x6bDc36E20D267Ff0dd6097799f82e78907105e2F"
    },
    SWAP: {
        ROUTER: process.env.SWAP_ROUTER,
        PERCENT: parseFloat(process.env.SWAP_PERCENT || "1"),
        SLIPPAGE: parseFloat(process.env.SWAP_SLIPPAGE || "0.5") // 0.5% default
    },
    TRANSFER: {
        DURATION: parseInt(process.env.DURATION || "30000"), // 30 seconds
        MIN_AMOUNT: parseFloat(process.env.MIN_BALANCE || "0.000001"),
        MAX_AMOUNT: parseFloat(process.env.MAX_BALANCE || "0.00001"),
        GAS_PRICE: parseInt(process.env.GAS_PRICE || "1000000000"),
        GAS_LIMIT: parseInt(process.env.GAS_LIMIT || "300000")
    },
    MODE: process.env.SWAP_MODE || "ALL" // ALL, WGHO_TO_USDC, USDC_TO_WGHO, RANDOM
};

// ===== CONSTANTS =====
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const ROUTER_ABI = [
    "function swap(address tokenIn, address tokenOut, uint256 flags, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMin, uint8 v) external returns (uint256 amountOut)"
];

// Initialize provider
const provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);

// Track processed wallets
const processedWallets = new Set();

// Random addresses for transfers (replace with actual addresses)
const RANDOM_ADDRESSES = [
    "0xc741e8d3DBdE1255e2961df114CCc66075c5a6d5",
    "0x55333B9eA6f78E2f1407434A7fBF06f2914521b6",
    "0xEd07664C1943Ba7A1141543297F8dC26A476768c"
];

// ===== UTILITY FUNCTIONS =====
function getRandomAddress() {
    return RANDOM_ADDRESSES[Math.floor(Math.random() * RANDOM_ADDRESSES.length)];
}

function getRandomSwapMode() {
    const modes = ["WGHO_TO_USDC", "USDC_TO_WGHO"];
    return modes[Math.floor(Math.random() * modes.length)];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== WALLET FUNCTIONS =====
async function setupWallets() {
    try {
        const privateKeys = [];
        
        // Load private keys from environment
        for (let i = 1; i <= 10; i++) {
            const key = process.env[`PRIVATE_KEY_${i}`];
            if (key) privateKeys.push(key);
        }

        if (privateKeys.length < 2) {
            throw new Error("At least 2 private keys required in .env");
        }

        return privateKeys.map(key => new ethers.Wallet(key, provider));
    } catch (error) {
        console.error("Wallet setup failed:", error.message);
        log(`Wallet setup error: ${error.message}`, './lens_error.log');
        process.exit(1);
    }
}

// ===== BALANCE FUNCTIONS =====
async function getNativeBalance(address) {
    const balance = await provider.getBalance(address);
    return ethers.utils.formatEther(balance);
}

async function getTokenBalance(wallet, tokenAddress) {
    try {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        const [balance, decimals, symbol] = await Promise.all([
            contract.balanceOf(wallet.address),
            contract.decimals(),
            contract.symbol()
        ]);
        
        return {
            balance: ethers.utils.formatUnits(balance, decimals),
            rawBalance: balance,
            decimals,
            symbol
        };
    } catch (error) {
        console.error(`Token balance error: ${error.message}`);
        return { balance: "0", rawBalance: ethers.BigNumber.from(0) };
    }
}

// ===== TRANSFER FUNCTIONS =====
function calculateTransferAmount() {
    const amount = config.TRANSFER.MIN_AMOUNT + 
          Math.random() * (config.TRANSFER.MAX_AMOUNT - config.TRANSFER.MIN_AMOUNT);
    return parseFloat(amount.toFixed(6));
}

async function transferNative(wallet, toAddress, amount) {
    try {
        const tx = {
            to: toAddress,
            value: ethers.utils.parseEther(amount.toString()),
            gasLimit: config.TRANSFER.GAS_LIMIT,
            gasPrice: config.TRANSFER.GAS_PRICE,
            nonce: await provider.getTransactionCount(wallet.address),
            chainId: config.CHAIN_ID
        };

        const txResponse = await wallet.sendTransaction(tx);
        console.log(`Transfer sent: ${txResponse.hash}`);
        log(`Transfer ${wallet.address} -> ${toAddress}: ${txResponse.hash}`, './lens_transfers.log');
        
        processedWallets.add(wallet.address);
        return txResponse;
    } catch (error) {
        console.error(`Transfer failed: ${error.message}`);
        throw error;
    }
}

// ===== SWAP FUNCTIONS =====
function calculateMinAmountOut(amountIn, slippage = config.SWAP.SLIPPAGE) {
    const slippageFactor = (100 - slippage) / 100;
    return amountIn.mul(ethers.BigNumber.from(Math.floor(slippageFactor * 1000))).div(1000);
}

async function executeSwap(wallet, tokenIn, tokenOut, amountIn) {
    try {
        // 1. Approve router to spend tokens
        const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
        const approveTx = await tokenContract.approve(config.SWAP.ROUTER, amountIn);
        await approveTx.wait();
        console.log(`Approval complete: ${approveTx.hash}`);

        // 2. Prepare swap parameters
        const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
        const amountOutMin = calculateMinAmountOut(amountIn);
        const flags = 100; // Example flag value

        // 3. Execute swap
        const router = new ethers.Contract(config.SWAP.ROUTER, ROUTER_ABI, wallet);
        const swapTx = await router.swap(
            tokenIn,
            tokenOut,
            flags,
            wallet.address,
            deadline,
            amountIn,
            amountOutMin,
            0 // v parameter
        );

        console.log(`Swap initiated: ${swapTx.hash}`);
        const receipt = await swapTx.wait();
        console.log(`Swap confirmed in block ${receipt.blockNumber}`);
        
        return swapTx;
    } catch (error) {
        console.error(`Swap failed: ${error.message}`);
        if (error.transaction) {
            console.error(`Failed TX: ${error.transaction.hash}`);
        }
        throw error;
    }
}

async function processSwaps(wallet) {
    if (!config.SWAP.ROUTER) {
        console.log("Swap router not configured");
        return;
    }

    try {
        // Get token balances
        const [wghoBalance, usdcBalance] = await Promise.all([
            getTokenBalance(wallet, config.TOKENS.WGHO),
            getTokenBalance(wallet, config.TOKENS.USDC)
        ]);

        // Determine swap mode
        let swapMode = config.MODE;
        if (swapMode === "RANDOM") swapMode = getRandomSwapMode();

        // Calculate swap amount
        let tokenIn, tokenOut, amount;
        if (swapMode === "WGHO_TO_USDC" && parseFloat(wghoBalance.balance) > 0) {
            tokenIn = config.TOKENS.WGHO;
            tokenOut = config.TOKENS.USDC;
            amount = wghoBalance.rawBalance.mul(config.SWAP.PERCENT).div(100);
        } 
        else if (swapMode === "USDC_TO_WGHO" && parseFloat(usdcBalance.balance) > 0) {
            tokenIn = config.TOKENS.USDC;
            tokenOut = config.TOKENS.WGHO;
            amount = usdcBalance.rawBalance.mul(config.SWAP.PERCENT).div(100);
        } else {
            console.log("No balance for selected swap mode");
            return;
        }

        if (amount.gt(0)) {
            console.log(`Executing ${swapMode} swap for ${ethers.utils.formatUnits(amount, tokenIn === config.TOKENS.WGHO ? wghoBalance.decimals : usdcBalance.decimals)}`);
            await executeSwap(wallet, tokenIn, tokenOut, amount);
        }
    } catch (error) {
        console.error(`Swap processing error: ${error.message}`);
    }
}

// ===== MAIN EXECUTION =====
async function main() {
    console.log("Starting Lens Protocol automation");
    
    // 1. Initialize wallets
    const wallets = await setupWallets();
    console.log(`Initialized ${wallets.length} wallets`);

    // 2. Process initial native transfers
    for (const wallet of wallets) {
        if (!processedWallets.has(wallet.address)) {
            try {
                const balance = await getNativeBalance(wallet.address);
                if (parseFloat(balance) > config.TRANSFER.MIN_AMOUNT) {
                    const amount = calculateTransferAmount();
                    await transferNative(wallet, getRandomAddress(), amount);
                }
                await sleep(2000); // Rate limiting
            } catch (error) {
                console.error(`Wallet ${wallet.address} error: ${error.message}`);
            }
        }
    }

    // 3. Continuous swap processing
    while (true) {
        console.log("Starting swap cycle");
        for (const wallet of wallets) {
            try {
                await processSwaps(wallet);
                await sleep(3000); // Rate limiting
            } catch (error) {
                console.error(`Wallet ${wallet.address} swap error: ${error.message}`);
            }
        }
        console.log(`Swap cycle completed. Waiting ${config.TRANSFER.DURATION/1000} seconds...`);
        await sleep(config.TRANSFER.DURATION);
    }
}

// Start the process
main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
