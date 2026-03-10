// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LLMintVault} from "../src/LLMintVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract Deploy is Script {
    address constant ANVIL_ACCOUNT_0 =
        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ANVIL_ACCOUNT_1 =
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant ANVIL_ACCOUNT_2 =
        0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint256 constant MINT_AMOUNT = 10_000e6;

    function run() external {
        vm.startBroadcast();

        address deployer = msg.sender;

        if (block.chainid == 31337) {
            deployAnvil(deployer);
        } else {
            deployTestnet(deployer);
        }

        vm.stopBroadcast();
    }

    function deployAnvil(address deployer) internal {
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        LLMintVault vault = new LLMintVault(
            address(usdc),
            deployer
        );
        console.log("LLMintVault deployed at:", address(vault));

        usdc.mint(ANVIL_ACCOUNT_0, MINT_AMOUNT);
        usdc.mint(ANVIL_ACCOUNT_1, MINT_AMOUNT);
        usdc.mint(ANVIL_ACCOUNT_2, MINT_AMOUNT);
        console.log("Minted 10,000 USDC to first 3 Anvil accounts");
    }

    function deployTestnet(address deployer) internal {
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        console.log("Using USDC at:", usdcAddress);

        LLMintVault vault = new LLMintVault(
            usdcAddress,
            deployer
        );
        console.log("LLMintVault deployed at:", address(vault));
    }
}
