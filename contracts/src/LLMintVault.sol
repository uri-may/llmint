// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LLMintVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAmount();
    error InsufficientAvailable(uint256 requested, uint256 available);
    error ActiveLockExists(address user);
    error NoActiveLock(address user);
    error LockNotStale(address user, uint256 unlockTime);
    error SettlementExceedsLock(uint256 cost, uint256 locked);
    error InsufficientEarnings(uint256 requested, uint256 available);

    // --- Events ---
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event SessionLocked(
        address indexed user, uint256 amount, uint256 nonce
    );
    event SessionSettled(
        address indexed user,
        uint256 nonce,
        uint256 totalCost,
        uint256 callCount,
        bytes32 merkleRoot,
        bytes32 chainHash,
        bytes32 arweaveTxId
    );
    event StaleLockReleased(address indexed user, uint256 amount);

    // --- Types ---
    struct Settlement {
        bytes32 merkleRoot;
        bytes32 chainHash;
        uint256 totalCost;
        uint256 callCount;
        uint256 timestamp;
        bytes32 arweaveTxId;
    }

    // --- Constants ---
    uint256 public constant STALE_LOCK_TIMEOUT = 24 hours;

    // --- State ---
    IERC20 public immutable USDC;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public locked;
    mapping(address => uint256) public lockTimestamps;
    mapping(address => uint256) public sessionNonces;
    mapping(address => mapping(uint256 => Settlement))
        public settlements;

    uint256 public platformBalance;

    // --- Constructor ---
    constructor(
        address usdcAddress,
        address platform
    ) Ownable(platform) {
        USDC = IERC20(usdcAddress);
    }

    // --- User Functions ---

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender] - locked[msg.sender];
        if (amount > available) {
            revert InsufficientAvailable(amount, available);
        }
        balances[msg.sender] -= amount;
        USDC.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // --- View Functions ---

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function lockedOf(address user) external view returns (uint256) {
        return locked[user];
    }

    function availableOf(
        address user
    ) external view returns (uint256) {
        return balances[user] - locked[user];
    }

    // --- Platform Functions ---

    function lockSession(
        address user,
        uint256 amount
    ) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (locked[user] > 0) revert ActiveLockExists(user);
        uint256 available = balances[user] - locked[user];
        if (amount > available) {
            revert InsufficientAvailable(amount, available);
        }
        locked[user] = amount;
        lockTimestamps[user] = block.timestamp;
        emit SessionLocked(user, amount, sessionNonces[user]);
    }

    function settle(
        address user,
        uint256 totalCost,
        uint256 callCount,
        bytes32 merkleRoot,
        bytes32 chainHash,
        bytes32 arweaveTxId
    ) external onlyOwner {
        if (locked[user] == 0) revert NoActiveLock(user);
        if (totalCost > locked[user]) {
            revert SettlementExceedsLock(totalCost, locked[user]);
        }

        uint256 nonce = sessionNonces[user];

        balances[user] -= totalCost;
        platformBalance += totalCost;
        locked[user] = 0;
        lockTimestamps[user] = 0;

        settlements[user][nonce] = Settlement({
            merkleRoot: merkleRoot,
            chainHash: chainHash,
            totalCost: totalCost,
            callCount: callCount,
            timestamp: block.timestamp,
            arweaveTxId: arweaveTxId
        });

        sessionNonces[user] = nonce + 1;

        emit SessionSettled(
            user,
            nonce,
            totalCost,
            callCount,
            merkleRoot,
            chainHash,
            arweaveTxId
        );
    }

    function withdrawEarnings(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > platformBalance) {
            revert InsufficientEarnings(amount, platformBalance);
        }
        platformBalance -= amount;
        USDC.safeTransfer(owner(), amount);
    }

    // --- Public Recovery ---

    function releaseStaleLock(address user) external {
        if (locked[user] == 0) revert NoActiveLock(user);
        uint256 unlockTime = lockTimestamps[user] + STALE_LOCK_TIMEOUT;
        if (block.timestamp < unlockTime) {
            revert LockNotStale(user, unlockTime);
        }
        uint256 amount = locked[user];
        locked[user] = 0;
        lockTimestamps[user] = 0;
        emit StaleLockReleased(user, amount);
    }
}
