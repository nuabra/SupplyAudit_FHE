pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SupplyAudit_FHE is ZamaEthereumConfig {
    struct AuditRecord {
        string componentId;
        euint32 encryptedComplianceScore;
        uint256 publicBatchSize;
        uint256 publicTimestamp;
        string materialSource;
        address supplier;
        uint32 decryptedScore;
        bool isAudited;
    }

    mapping(string => AuditRecord) public auditRecords;
    string[] public componentIds;

    event AuditRecordCreated(string indexed componentId, address indexed supplier);
    event ComplianceVerified(string indexed componentId, uint32 decryptedScore);

    constructor() ZamaEthereumConfig() {
        // Initialize contract with Zama configuration
    }

    function createAuditRecord(
        string calldata componentId,
        string calldata materialSource,
        externalEuint32 encryptedComplianceScore,
        bytes calldata inputProof,
        uint256 publicBatchSize,
        uint256 publicTimestamp
    ) external {
        require(bytes(auditRecords[componentId].componentId).length == 0, "Component record exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedComplianceScore, inputProof)), "Invalid encrypted input");

        auditRecords[componentId] = AuditRecord({
            componentId: componentId,
            encryptedComplianceScore: FHE.fromExternal(encryptedComplianceScore, inputProof),
            publicBatchSize: publicBatchSize,
            publicTimestamp: publicTimestamp,
            materialSource: materialSource,
            supplier: msg.sender,
            decryptedScore: 0,
            isAudited: false
        });

        FHE.allowThis(auditRecords[componentId].encryptedComplianceScore);
        FHE.makePubliclyDecryptable(auditRecords[componentId].encryptedComplianceScore);
        componentIds.push(componentId);

        emit AuditRecordCreated(componentId, msg.sender);
    }

    function verifyCompliance(
        string calldata componentId,
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(bytes(auditRecords[componentId].componentId).length > 0, "Component record missing");
        require(!auditRecords[componentId].isAudited, "Already audited");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(auditRecords[componentId].encryptedComplianceScore);

        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);
        uint32 decodedScore = abi.decode(abiEncodedClearScore, (uint32));

        auditRecords[componentId].decryptedScore = decodedScore;
        auditRecords[componentId].isAudited = true;

        emit ComplianceVerified(componentId, decodedScore);
    }

    function getEncryptedScore(string calldata componentId) external view returns (euint32) {
        require(bytes(auditRecords[componentId].componentId).length > 0, "Component record missing");
        return auditRecords[componentId].encryptedComplianceScore;
    }

    function getAuditRecord(string calldata componentId) external view returns (
        string memory materialSource,
        uint256 publicBatchSize,
        uint256 publicTimestamp,
        address supplier,
        bool isAudited,
        uint32 decryptedScore
    ) {
        require(bytes(auditRecords[componentId].componentId).length > 0, "Component record missing");
        AuditRecord storage record = auditRecords[componentId];

        return (
            record.materialSource,
            record.publicBatchSize,
            record.publicTimestamp,
            record.supplier,
            record.isAudited,
            record.decryptedScore
        );
    }

    function getAllComponentIds() external view returns (string[] memory) {
        return componentIds;
    }

    function systemStatus() public pure returns (bool) {
        return true;
    }
}

