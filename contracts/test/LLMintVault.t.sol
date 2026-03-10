// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LLMintVault} from "../src/LLMintVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract LLMintVaultTest is Test {
    LLMintVault public vault;
    MockUSDC public usdc;

    address platform = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address eve = makeAddr("eve");

    uint256 constant INITIAL_BALANCE = 10_000e6;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new LLMintVault(address(usdc), platform);

        usdc.mint(alice, INITIAL_BALANCE);
        usdc.mint(bob, INITIAL_BALANCE);
        usdc.mint(eve, INITIAL_BALANCE);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(eve);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ========================
    // Deposit tests
    // ========================

    function test_deposit_success() public {
        vm.prank(alice);
        vault.deposit(100e6);

        assertEq(vault.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(alice), INITIAL_BALANCE - 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
    }

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LLMintVault.Deposited(alice, 100e6);

        vm.prank(alice);
        vault.deposit(100e6);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert(LLMintVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_noApproval_reverts() public {
        address noApproval = makeAddr("noApproval");
        usdc.mint(noApproval, 100e6);

        vm.prank(noApproval);
        vm.expectRevert();
        vault.deposit(100e6);
    }

    function test_deposit_multipleAccumulates() public {
        vm.startPrank(alice);
        vault.deposit(50e6);
        vault.deposit(30e6);
        vault.deposit(20e6);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), 100e6);
    }

    // ========================
    // Withdraw tests
    // ========================

    function test_withdraw_full() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(alice);
        vault.withdraw(100e6);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), INITIAL_BALANCE);
    }

    function test_withdraw_partial() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(alice);
        vault.withdraw(40e6);

        assertEq(vault.balanceOf(alice), 60e6);
        assertEq(usdc.balanceOf(alice), INITIAL_BALANCE - 60e6);
    }

    function test_withdraw_emitsEvent() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.expectEmit(true, false, false, true);
        emit LLMintVault.Withdrawn(alice, 40e6);

        vm.prank(alice);
        vault.withdraw(40e6);
    }

    function test_withdraw_zero_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(alice);
        vm.expectRevert(LLMintVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_withdraw_exceedsBalance_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.InsufficientAvailable.selector,
                200e6,
                100e6
            )
        );
        vault.withdraw(200e6);
    }

    function test_withdraw_respectsLock() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vault.lockSession(alice, 60e6);

        vm.prank(alice);
        vault.withdraw(40e6);
        assertEq(vault.balanceOf(alice), 60e6);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.InsufficientAvailable.selector,
                1,
                0
            )
        );
        vault.withdraw(1);
    }

    // ========================
    // Lock session tests
    // ========================

    function test_lockSession_success() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vault.lockSession(alice, 50e6);

        assertEq(vault.lockedOf(alice), 50e6);
        assertEq(vault.availableOf(alice), 50e6);
        assertEq(vault.balanceOf(alice), 100e6);
    }

    function test_lockSession_emitsEvent() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.expectEmit(true, false, false, true);
        emit LLMintVault.SessionLocked(alice, 50e6, 0);

        vault.lockSession(alice, 50e6);
    }

    function test_lockSession_nonPlatform_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(eve);
        vm.expectRevert();
        vault.lockSession(alice, 50e6);
    }

    function test_lockSession_activeLock_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vault.lockSession(alice, 30e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.ActiveLockExists.selector, alice
            )
        );
        vault.lockSession(alice, 20e6);
    }

    function test_lockSession_exceedsAvailable_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.InsufficientAvailable.selector,
                200e6,
                100e6
            )
        );
        vault.lockSession(alice, 200e6);
    }

    function test_lockSession_zero_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.expectRevert(LLMintVault.ZeroAmount.selector);
        vault.lockSession(alice, 0);
    }

    // ========================
    // Settle tests
    // ========================

    bytes32 constant MERKLE_ROOT = keccak256("merkle");
    bytes32 constant CHAIN_HASH = keccak256("chain");
    bytes32 constant ARWEAVE_TX = keccak256("arweave");

    function test_settle_success() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        assertEq(vault.balanceOf(alice), 70e6);
        assertEq(vault.lockedOf(alice), 0);
        assertEq(vault.platformBalance(), 30e6);
        assertEq(vault.sessionNonces(alice), 1);
    }

    function test_settle_emitsEvent() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.expectEmit(true, false, false, true);
        emit LLMintVault.SessionSettled(
            alice, 0, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
    }

    function test_settle_nonPlatform_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.prank(eve);
        vm.expectRevert();
        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
    }

    function test_settle_noLock_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.NoActiveLock.selector, alice
            )
        );
        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
    }

    function test_settle_exceedsLock_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.SettlementExceedsLock.selector, 60e6, 50e6
            )
        );
        vault.settle(
            alice, 60e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
    }

    function test_settle_storesAllFields() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        (
            bytes32 merkleRoot,
            bytes32 chainHash,
            uint256 totalCost,
            uint256 callCount,
            uint256 timestamp,
            bytes32 arweaveTxId
        ) = vault.settlements(alice, 0);

        assertEq(merkleRoot, MERKLE_ROOT);
        assertEq(chainHash, CHAIN_HASH);
        assertEq(totalCost, 30e6);
        assertEq(callCount, 200);
        assertEq(timestamp, block.timestamp);
        assertEq(arweaveTxId, ARWEAVE_TX);
    }

    function test_settle_zeroCost() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vault.settle(
            alice, 0, 0, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        assertEq(vault.balanceOf(alice), 100e6);
        assertEq(vault.lockedOf(alice), 0);
        assertEq(vault.platformBalance(), 0);
        assertEq(vault.sessionNonces(alice), 1);
    }

    function test_settle_incrementsNonce() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vault.lockSession(alice, 10e6);
        vault.settle(
            alice, 5e6, 100, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
        assertEq(vault.sessionNonces(alice), 1);

        vault.lockSession(alice, 10e6);
        vault.settle(
            alice, 5e6, 50, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
        assertEq(vault.sessionNonces(alice), 2);
    }

    // ========================
    // Release stale lock tests
    // ========================

    function test_releaseStaleLock_afterTimeout() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vault.releaseStaleLock(alice);

        assertEq(vault.lockedOf(alice), 0);
        assertEq(vault.balanceOf(alice), 100e6);
    }

    function test_releaseStaleLock_emitsEvent() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.expectEmit(true, false, false, true);
        emit LLMintVault.StaleLockReleased(alice, 50e6);

        vault.releaseStaleLock(alice);
    }

    function test_releaseStaleLock_beforeTimeout_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        uint256 unlockTime = block.timestamp + 24 hours;

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.LockNotStale.selector, alice, unlockTime
            )
        );
        vault.releaseStaleLock(alice);
    }

    function test_releaseStaleLock_noLock_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.NoActiveLock.selector, alice
            )
        );
        vault.releaseStaleLock(alice);
    }

    function test_releaseStaleLock_noNonceIncrement() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        uint256 nonceBefore = vault.sessionNonces(alice);
        vm.warp(block.timestamp + 24 hours + 1);
        vault.releaseStaleLock(alice);

        assertEq(vault.sessionNonces(alice), nonceBefore);
    }

    function test_releaseStaleLock_callableByAnyone() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(eve);
        vault.releaseStaleLock(alice);

        assertEq(vault.lockedOf(alice), 0);
    }

    // ========================
    // WithdrawEarnings tests
    // ========================

    function test_withdrawEarnings_success() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);
        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        uint256 platformUsdcBefore = usdc.balanceOf(platform);
        vault.withdrawEarnings(30e6);

        assertEq(vault.platformBalance(), 0);
        assertEq(
            usdc.balanceOf(platform), platformUsdcBefore + 30e6
        );
    }

    function test_withdrawEarnings_zero_reverts() public {
        vm.expectRevert(LLMintVault.ZeroAmount.selector);
        vault.withdrawEarnings(0);
    }

    function test_withdrawEarnings_exceedsBalance_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);
        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.InsufficientEarnings.selector, 50e6, 30e6
            )
        );
        vault.withdrawEarnings(50e6);
    }

    function test_withdrawEarnings_nonPlatform_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 50e6);
        vault.settle(
            alice, 30e6, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        vm.prank(eve);
        vm.expectRevert();
        vault.withdrawEarnings(30e6);
    }

    // ========================
    // View function tests
    // ========================

    function test_viewFunctions_defaults() public view {
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.lockedOf(alice), 0);
        assertEq(vault.availableOf(alice), 0);
    }

    function test_viewFunctions_withLock() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vault.lockSession(alice, 40e6);

        assertEq(vault.balanceOf(alice), 100e6);
        assertEq(vault.lockedOf(alice), 40e6);
        assertEq(vault.availableOf(alice), 60e6);
    }

    // ========================
    // Fuzz tests
    // ========================

    function testFuzz_deposit(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(vault), amount);

        vm.prank(alice);
        vault.deposit(amount);

        assertEq(vault.balanceOf(alice), amount);
    }

    function testFuzz_withdraw(
        uint256 depositAmt,
        uint256 withdrawAmt
    ) public {
        depositAmt = bound(depositAmt, 1, type(uint128).max);
        withdrawAmt = bound(withdrawAmt, 1, depositAmt);

        usdc.mint(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(vault), depositAmt);

        vm.prank(alice);
        vault.deposit(depositAmt);

        vm.prank(alice);
        vault.withdraw(withdrawAmt);

        assertEq(vault.balanceOf(alice), depositAmt - withdrawAmt);
    }

    // ========================
    // Scenario: Full session lifecycle
    // ========================

    function test_scenario_fullLifecycle() public {
        vm.prank(alice);
        vault.deposit(50e6);

        vault.lockSession(alice, 10e6);

        assertEq(vault.availableOf(alice), 40e6);

        vault.settle(
            alice, 4_200_000, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        assertEq(vault.balanceOf(alice), 50e6 - 4_200_000);
        assertEq(vault.lockedOf(alice), 0);
        assertEq(vault.availableOf(alice), 50e6 - 4_200_000);
        assertEq(vault.platformBalance(), 4_200_000);
        assertEq(vault.sessionNonces(alice), 1);
    }

    function test_scenario_withdrawAfterSettle() public {
        vm.prank(alice);
        vault.deposit(50e6);

        vault.lockSession(alice, 10e6);
        vault.settle(
            alice, 4_200_000, 200, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );

        uint256 remaining = vault.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(remaining);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), INITIAL_BALANCE - 4_200_000);
    }

    function test_scenario_multipleSessions() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vault.lockSession(alice, 20e6);
        vault.settle(
            alice, 5e6, 100,
            keccak256("m1"), keccak256("c1"), keccak256("a1")
        );
        assertEq(vault.sessionNonces(alice), 1);

        vault.lockSession(alice, 20e6);
        vault.settle(
            alice, 8e6, 150,
            keccak256("m2"), keccak256("c2"), keccak256("a2")
        );
        assertEq(vault.sessionNonces(alice), 2);

        vault.lockSession(alice, 20e6);
        vault.settle(
            alice, 3e6, 50,
            keccak256("m3"), keccak256("c3"), keccak256("a3")
        );
        assertEq(vault.sessionNonces(alice), 3);

        assertEq(vault.balanceOf(alice), 100e6 - 16e6);
        assertEq(vault.platformBalance(), 16e6);
    }

    function test_scenario_raceConditionAttack() public {
        vm.prank(alice);
        vault.deposit(50e6);

        vault.lockSession(alice, 10e6);

        vm.prank(alice);
        vault.withdraw(40e6);
        assertEq(vault.balanceOf(alice), 10e6);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                LLMintVault.InsufficientAvailable.selector, 1, 0
            )
        );
        vault.withdraw(1);

        vault.settle(
            alice, 4e6, 100, MERKLE_ROOT, CHAIN_HASH, ARWEAVE_TX
        );
        assertEq(vault.balanceOf(alice), 6e6);
    }
}
