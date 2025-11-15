// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PredictionRewardPool
/// @notice Collects entry fees for prediction rounds and lets winners claim rewards using owner-issued signatures.
contract PredictionRewardPool {
    uint256 public constant ENTRY_FEE_WEI = 0.1 ether;

    address public immutable owner;

    struct BetInfo {
        uint256 amount;
        bool paid;
        bool rewardClaimed;
    }

    mapping(bytes32 => BetInfo) private bets;

    event BetPlaced(
        bytes32 indexed betKey,
        uint256 indexed roundId,
        address indexed player,
        string asset,
        string side,
        uint256 amount
    );

    event RewardClaimed(
        bytes32 indexed betKey,
        address indexed player,
        uint256 payout
    );

    event OwnerWithdrawal(address indexed to, uint256 amount);

    error NotOwner();
    error EntryFeeRequired();
    error BetAlreadyPlaced();
    error BetNotFound();
    error RewardAlreadyClaimed();
    error InvalidSignature();
    error InvalidPayout();
    error TransferFailed();
    error PoolShortfall();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Pay the entry fee for a specific bet in a round.
    /// @return betKey Unique key derived from round, player, asset, and side.
    function placeBet(
        uint256 roundId,
        string calldata asset,
        string calldata side
    ) external payable returns (bytes32 betKey) {
        if (msg.value != ENTRY_FEE_WEI) revert EntryFeeRequired();

        betKey = _computeBetKey(roundId, msg.sender, asset, side);
        BetInfo storage bet = bets[betKey];
        if (bet.paid) revert BetAlreadyPlaced();

        bet.amount = msg.value;
        bet.paid = true;
        emit BetPlaced(betKey, roundId, msg.sender, asset, side, msg.value);
    }

    /// @notice Returns true if the player already paid the entry fee for this bet.
    function hasBet(
        uint256 roundId,
        address player,
        string calldata asset,
        string calldata side
    ) external view returns (bool) {
        bytes32 betKey = _computeBetKey(roundId, player, asset, side);
        return bets[betKey].paid;
    }

    /// @notice Claim a reward that was signed off-chain by the contract owner.
    /// @param roundId The round identifier for the bet.
    /// @param asset Asset symbol the player bet on.
    /// @param side Side the player chose (e.g. "UP" or "DOWN").
    /// @param payout Amount to withdraw from the pool (must be authorised by owner signature).
    /// @param signature Owner signed message authorising the payout.
    function claimReward(
        uint256 roundId,
        string calldata asset,
        string calldata side,
        uint256 payout,
        bytes calldata signature
    ) external {
        if (payout == 0) revert InvalidPayout();

        bytes32 betKey = _computeBetKey(roundId, msg.sender, asset, side);
        BetInfo storage bet = bets[betKey];
        if (!bet.paid) revert BetNotFound();
        if (bet.rewardClaimed) revert RewardAlreadyClaimed();

        bytes32 payloadHash = _rewardHash(betKey, msg.sender, payout);
        bytes32 digest = _toEthSignedMessageHash(payloadHash);
        if (_recoverSigner(digest, signature) != owner) revert InvalidSignature();

        bet.rewardClaimed = true;

        if (address(this).balance < payout) revert PoolShortfall();
        (bool sent, ) = msg.sender.call{ value: payout }("");
        if (!sent) revert TransferFailed();

        emit RewardClaimed(betKey, msg.sender, payout);
    }

    /// @notice Withdraw unallocated funds from the pool.
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        (bool sent, ) = to.call{ value: amount }("");
        if (!sent) revert TransferFailed();
        emit OwnerWithdrawal(to, amount);
    }

    /// @notice Expose bet information for front-ends.
    function getBet(bytes32 betKey) external view returns (BetInfo memory) {
        return bets[betKey];
    }

    /// @notice Helper to compute bet keys off-chain.
    function computeBetKey(
        uint256 roundId,
        address player,
        string calldata asset,
        string calldata side
    ) external pure returns (bytes32) {
        return _computeBetKey(roundId, player, asset, side);
    }

    /// @notice Authorisation hash used for signatures (EIP-191 compatible).
    function rewardHash(
        bytes32 betKey,
        address player,
        uint256 payout
    ) external view returns (bytes32) {
        return _rewardHash(betKey, player, payout);
    }

    receive() external payable {}

    fallback() external payable {}

    function _computeBetKey(
        uint256 roundId,
        address player,
        string calldata asset,
        string calldata side
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                roundId,
                player,
                keccak256(bytes(asset)),
                keccak256(bytes(side))
            )
        );
    }

    function _rewardHash(
        bytes32 betKey,
        address player,
        uint256 payout
    ) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "IRYS_PREDICTION_REWARD",
                address(this),
                block.chainid,
                betKey,
                player,
                payout
            )
        );
    }

    function _recoverSigner(bytes32 hash, bytes memory signature) private pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        if (v < 27) {
            v += 27;
        }
        return ecrecover(hash, v, r, s);
    }

    function _toEthSignedMessageHash(bytes32 messageHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    }

    function _splitSignature(bytes memory sig)
        private
        pure
        returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(sig.length == 65, "BAD_SIG_LENGTH");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
