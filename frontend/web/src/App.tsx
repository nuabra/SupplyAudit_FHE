import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SupplyAuditData {
  id: string;
  name: string;
  productionValue: string;
  qualityScore: string;
  batchNumber: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface AuditStats {
  totalAudits: number;
  verifiedAudits: number;
  avgQualityScore: number;
  recentAudits: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<SupplyAuditData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAudit, setCreatingAudit] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuditData, setNewAuditData] = useState({ 
    name: "", 
    productionValue: "", 
    qualityScore: "", 
    batchNumber: "" 
  });
  const [selectedAudit, setSelectedAudit] = useState<SupplyAuditData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [stats, setStats] = useState<AuditStats>({
    totalAudits: 0,
    verifiedAudits: 0,
    avgQualityScore: 0,
    recentAudits: 0
  });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateStats();
  }, [audits]);

  const calculateStats = () => {
    const totalAudits = audits.length;
    const verifiedAudits = audits.filter(a => a.isVerified).length;
    const avgQualityScore = audits.length > 0 
      ? audits.reduce((sum, a) => sum + a.publicValue1, 0) / audits.length 
      : 0;
    const recentAudits = audits.filter(a => 
      Date.now()/1000 - a.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({
      totalAudits,
      verifiedAudits,
      avgQualityScore,
      recentAudits
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auditsList: SupplyAuditData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auditsList.push({
            id: businessId,
            name: businessData.name,
            productionValue: businessId,
            qualityScore: businessId,
            batchNumber: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAudits(auditsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAudit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAudit(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating audit with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const productionValue = parseInt(newAuditData.productionValue) || 0;
      const businessId = `audit-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, productionValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuditData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newAuditData.qualityScore) || 0,
        0,
        `Batch: ${newAuditData.batchNumber}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Audit created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAuditData({ name: "", productionValue: "", qualityScore: "", batchNumber: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAudit(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredAudits = audits.filter(audit => {
    const matchesSearch = audit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         audit.batchNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || audit.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderStatsPanel = () => {
    return (
      <div className="stats-panel">
        <div className="stat-item bronze">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalAudits}</div>
            <div className="stat-label">Total Audits</div>
          </div>
        </div>
        
        <div className="stat-item copper">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedAudits}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-item steel">
          <div className="stat-icon">⭐</div>
          <div className="stat-content">
            <div className="stat-value">{stats.avgQualityScore.toFixed(1)}</div>
            <div className="stat-label">Avg Quality</div>
          </div>
        </div>
        
        <div className="stat-item titanium">
          <div className="stat-icon">🆕</div>
          <div className="stat-content">
            <div className="stat-value">{stats.recentAudits}</div>
            <div className="stat-label">This Week</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Production Data</h4>
            <p>Sensitive manufacturing data encrypted with FHE</p>
          </div>
        </div>
        <div className="process-arrow">⚙️</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Homomorphic Verification</h4>
            <p>Audit rules applied without decryption</p>
          </div>
        </div>
        <div className="process-arrow">⚙️</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Secure Decryption</h4>
            <p>Only authorized parties can decrypt results</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="gear-icon">⚙️</div>
            <h1>Supply Chain Audit FHE</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="industrial-panel">
            <div className="panel-content">
              <div className="industrial-icon">🔐</div>
              <h2>Connect to Industrial Audit System</h2>
              <p>Secure supply chain verification with fully homomorphic encryption</p>
              <div className="industrial-steps">
                <div className="industrial-step">
                  <span className="step-badge">1</span>
                  <p>Connect your industrial wallet</p>
                </div>
                <div className="industrial-step">
                  <span className="step-badge">2</span>
                  <p>Initialize FHE encryption system</p>
                </div>
                <div className="industrial-step">
                  <span className="step-badge">3</span>
                  <p>Start confidential auditing process</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="industrial-spinner"></div>
        <p>Initializing Industrial FHE System...</p>
        <p className="loading-note">Securing supply chain data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="industrial-spinner"></div>
      <p>Loading audit system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="gear-icon">⚙️</div>
          <div>
            <h1>Supply Chain Audit FHE</h1>
            <p>Industrial Confidential Verification</p>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="industrial-btn primary"
          >
            + New Audit
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panel">
          <h2>Supply Chain Overview</h2>
          {renderStatsPanel()}
          
          <div className="industrial-panel">
            <h3>FHE Audit Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="audits-section">
          <div className="section-header">
            <h2>Production Audits</h2>
            <div className="controls-panel">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search audits..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="industrial-input"
                />
              </div>
              <label className="filter-toggle">
                <input 
                  type="checkbox" 
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Verified Only
              </label>
              <button 
                onClick={loadData} 
                className="industrial-btn secondary"
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="audits-list">
            {filteredAudits.length === 0 ? (
              <div className="no-audits">
                <div className="industrial-icon">📋</div>
                <p>No audit records found</p>
                <button 
                  className="industrial-btn primary" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Audit
                </button>
              </div>
            ) : filteredAudits.map((audit, index) => (
              <div 
                className={`audit-item ${selectedAudit?.id === audit.id ? "selected" : ""} ${audit.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedAudit(audit)}
              >
                <div className="audit-header">
                  <div className="audit-title">{audit.name}</div>
                  <div className={`audit-status ${audit.isVerified ? "verified" : "pending"}`}>
                    {audit.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </div>
                </div>
                <div className="audit-details">
                  <span>Batch: {audit.batchNumber}</span>
                  <span>Quality: {audit.publicValue1}/10</span>
                  <span>{new Date(audit.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="audit-creator">
                  Factory: {audit.creator.substring(0, 8)}...{audit.creator.substring(36)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateAudit 
          onSubmit={createAudit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAudit} 
          auditData={newAuditData} 
          setAuditData={setNewAuditData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAudit && (
        <AuditDetailModal 
          audit={selectedAudit} 
          onClose={() => setSelectedAudit(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedAudit.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="industrial-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="industrial-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "⚠"}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateAudit: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  auditData: any;
  setAuditData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, auditData, setAuditData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'productionValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setAuditData({ ...auditData, [name]: intValue });
    } else {
      setAuditData({ ...auditData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="industrial-modal">
        <div className="modal-header">
          <h2>New Production Audit</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice industrial-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Industrial Encryption</strong>
              <p>Production data encrypted with industrial-grade FHE protection</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Product Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auditData.name} 
              onChange={handleChange} 
              placeholder="Enter product name..." 
              className="industrial-input"
            />
          </div>
          
          <div className="form-group">
            <label>Production Quantity (FHE Encrypted) *</label>
            <input 
              type="number" 
              name="productionValue" 
              value={auditData.productionValue} 
              onChange={handleChange} 
              placeholder="Enter quantity..." 
              className="industrial-input"
            />
            <div className="input-note">Encrypted integer data</div>
          </div>
          
          <div className="form-group">
            <label>Quality Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="qualityScore" 
              value={auditData.qualityScore} 
              onChange={handleChange} 
              placeholder="Enter quality score..." 
              className="industrial-input"
            />
            <div className="input-note">Public audit data</div>
          </div>
          
          <div className="form-group">
            <label>Batch Number *</label>
            <input 
              type="text" 
              name="batchNumber" 
              value={auditData.batchNumber} 
              onChange={handleChange} 
              placeholder="Enter batch number..." 
              className="industrial-input"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="industrial-btn secondary">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !auditData.name || !auditData.productionValue || !auditData.qualityScore || !auditData.batchNumber} 
            className="industrial-btn primary"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Audit"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuditDetailModal: React.FC<{
  audit: SupplyAuditData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ audit, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="industrial-modal large">
        <div className="modal-header">
          <h2>Audit Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="audit-info-grid">
            <div className="info-item">
              <label>Product Name</label>
              <span>{audit.name}</span>
            </div>
            <div className="info-item">
              <label>Batch Number</label>
              <span>{audit.batchNumber}</span>
            </div>
            <div className="info-item">
              <label>Factory</label>
              <span>{audit.creator.substring(0, 10)}...{audit.creator.substring(34)}</span>
            </div>
            <div className="info-item">
              <label>Date</label>
              <span>{new Date(audit.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-item">
              <label>Quality Score</label>
              <span className="quality-badge">{audit.publicValue1}/10</span>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Confidential Production Data</h3>
            
            <div className="encrypted-data">
              <div className="data-row">
                <span>Production Quantity:</span>
                <span className="data-value">
                  {audit.isVerified && audit.decryptedValue ? 
                    `${audit.decryptedValue} units (Verified)` : 
                    decryptedValue !== null ? 
                    `${decryptedValue} units (Decrypted)` : 
                    "🔒 FHE Encrypted"
                  }
                </span>
                <button 
                  className={`industrial-btn ${(audit.isVerified || decryptedValue !== null) ? 'verified' : 'encrypted'}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Processing..." : 
                   audit.isVerified ? "Verified" : 
                   decryptedValue !== null ? "Re-verify" : 
                   "Decrypt Data"}
                </button>
              </div>
            </div>
            
            <div className="fhe-explanation">
              <div className="explanation-icon">⚙️</div>
              <div>
                <strong>Industrial FHE Protection</strong>
                <p>Production quantities are encrypted using fully homomorphic encryption. 
                Audit verification occurs without exposing sensitive manufacturing data.</p>
              </div>
            </div>
          </div>
          
          {(audit.isVerified || decryptedValue !== null) && (
            <div className="verification-result">
              <h3>Audit Result</h3>
              <div className="result-grid">
                <div className="result-item">
                  <span>Production Volume</span>
                  <strong>{audit.isVerified ? audit.decryptedValue : decryptedValue} units</strong>
                </div>
                <div className="result-item">
                  <span>Quality Rating</span>
                  <strong>{audit.publicValue1}/10</strong>
                </div>
                <div className="result-item">
                  <span>Compliance Status</span>
                  <span className="status-badge compliant">Compliant</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="industrial-btn secondary">Close</button>
          {!audit.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="industrial-btn primary"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

