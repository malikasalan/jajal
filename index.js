const { ethers } = require('ethers');
const readline = require('readline');
require('dotenv').config();

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = 'https://rpc.lens.xyz';
const WGHO_ADDRESS = '0x6bDc36E20D267Ff0dd6097799f82e78907105e2F';
const DEFAULT_AMOUNT = 0.005; // Default swap amount in GHO

// Contract ABIs
const WGHO_ABI = [
  {
    "constant": false,
    "inputs": [],
    "name": "deposit",
    "outputs": [],
    "payable": true,
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{"name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];

async function main() {
  // Initialize provider (updated for ethers v6+)
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const wghoContract = new ethers.Contract(WGHO_ADDRESS, WGHO_ABI, wallet);

  console.log('\n=== GHO to wGHO Swapper ===');
  console.log(`Connected to: ${(await provider.getNetwork()).name}`);
  console.log(`Wallet address: ${wallet.address}`);

  // Helper function for user input
  const askQuestion = (query) => new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    });
  });

  try {
    // Get user input
    const iterations = await askQuestion('How many swaps would you like to perform? ');
    const customAmount = await askQuestion(`Enter amount per swap in GHO (default ${DEFAULT_AMOUNT}): `);
    
    const swapAmount = customAmount ? parseFloat(customAmount) : DEFAULT_AMOUNT;
    const numIterations = parseInt(iterations) || 1;
    
    console.log(`\nWill perform ${numIterations} swaps of ${swapAmount} GHO each`);

    // Execute swaps
    for (let i = 0; i < numIterations; i++) {
      console.log(`\n--- Swap ${i+1} of ${numIterations} ---`);
      
      try {
        const amountInWei = ethers.parseEther(swapAmount.toString());
        
        console.log(`Starting swap of ${swapAmount} GHO to wGHO...`);
        
        // Check balances
        const balanceBefore = await provider.getBalance(wallet.address);
        console.log(`GHO balance before: ${ethers.formatEther(balanceBefore)} GHO`);
        
        const wghoBalanceBefore = await wghoContract.balanceOf(wallet.address);
        console.log(`wGHO balance before: ${ethers.formatEther(wghoBalanceBefore)} wGHO`);

        // Execute swap
        const tx = await wghoContract.deposit({ value: amountInWei });
        console.log(`Transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`Confirmed in block ${receipt.blockNumber}`);

        // Check new balances
        const balanceAfter = await provider.getBalance(wallet.address);
        console.log(`GHO balance after: ${ethers.formatEther(balanceAfter)} GHO`);
        
        const wghoBalanceAfter = await wghoContract.balanceOf(wallet.address);
        console.log(`wGHO balance after: ${ethers.formatEther(wghoBalanceAfter)} wGHO`);

        // Wait between swaps if needed
        if (i < numIterations - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Error in swap ${i+1}:`, error);
      }
    }
    
    console.log('\nAll operations completed');
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

main().catch(console.error);
