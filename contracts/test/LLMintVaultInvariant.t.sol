// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LLMintVault} from "../src/LLMintVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract VaultHandler is Test {
    LLMintVault public vault;
    MockUSDC public usdc;
    address public platform;

    address[] public actors;
    mapping(address => bool) public isActor;

    constructor(
        LLMintVault _vault,
        MockUSDC _usdc,
        address _platform
    ) {
        vault = _vault;
        usdc = _usdc;
        platform = _platform;

        for (uint256 i = 0; i < 3; i++) {
            address actor = makeAddr(
                string(abi.encodePacked("actor", i))
            );
            actors.push(actor);
            isActor[actor] = true;
            usdc.mint(actor, 1_000_000e6);
            vm.prank(actor);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 10_000e6);

        vm.prank(actor);
        vault.deposit(amount);
    }

    function withdraw(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 available = vault.availableOf(actor);
        if (available == 0) return;
        amount = bound(amount, 1, available);

        vm.prank(actor);
        vault.withdraw(amount);
    }

    function lockSession(
        uint256 actorSeed,
        uint256 amount
    ) external {
        address actor = actors[actorSeed % actors.length];
        if (vault.lockedOf(actor) > 0) return;
        uint256 available = vault.availableOf(actor);
        if (available == 0) return;
        amount = bound(amount, 1, available);

        vm.prank(platform);
        vault.lockSession(actor, amount);
    }

    function settle(uint256 actorSeed, uint256 cost) external {
        address actor = actors[actorSeed % actors.length];
        uint256 lockedAmt = vault.lockedOf(actor);
        if (lockedAmt == 0) return;
        cost = bound(cost, 0, lockedAmt);

        vm.prank(platform);
        vault.settle(
            actor,
            cost,
            100,
            keccak256("merkle"),
            keccak256("chain"),
            keccak256("arweave")
        );
    }

    function releaseStaleLock(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (vault.lockedOf(actor) == 0) return;

        vm.warp(block.timestamp + 24 hours + 1);
        vault.releaseStaleLock(actor);
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }
}

contract LLMintVaultInvariantTest is Test {
    LLMintVault public vault;
    MockUSDC public usdc;
    VaultHandler public handler;

    address platform = address(this);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new LLMintVault(address(usdc), platform);
        handler = new VaultHandler(vault, usdc, platform);

        targetContract(address(handler));
    }

    function invariant_balanceSolvency() public view {
        address[] memory actors = handler.getActors();
        uint256 totalBalances;
        for (uint256 i = 0; i < actors.length; i++) {
            totalBalances += vault.balances(actors[i]);
        }
        uint256 platformBal = vault.platformBalance();

        assertEq(
            totalBalances + platformBal,
            usdc.balanceOf(address(vault))
        );
    }

    function invariant_lockedNeverExceedsBalance() public view {
        address[] memory actors = handler.getActors();
        for (uint256 i = 0; i < actors.length; i++) {
            assertLe(
                vault.locked(actors[i]),
                vault.balances(actors[i])
            );
        }
    }
}
