// src/irys.js
import { ethers } from 'ethers';
import { WebUploader } from '@irys/web-upload';
import { WebEthereum } from '@irys/web-upload-ethereum';
import { EthersV6Adapter } from '@irys/web-upload-ethereum-ethers-v6';

let _uploader = null;

export async function getIrysUploader() {
  if (_uploader) return _uploader;

  if (!window.ethereum) {
    throw new Error('No Ethereum provider found. Install MetaMask or another EVM wallet.');
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  // request account access (shows wallet prompt)
  await provider.send('eth_requestAccounts', []);
  _uploader = await WebUploader(WebEthereum).withAdapter(EthersV6Adapter(provider));
  return _uploader;
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error('No Ethereum provider');
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  return signer.getAddress();
}

export async function getBalancePretty() {
  const irys = await getIrysUploader();
  const atomic = await irys.getBalance();
  return irys.utils.fromAtomic(atomic); // string
}

/**
 * Funds your Irys balance with a human (ETH) amount like "0.02"
 * NOTE: funding uses the connected network token you’re paying with (Ethereum in this setup).
 */
export async function fundHumanAmount(humanAmountStr, feeMultiplier = undefined) {
  const irys = await getIrysUploader();
  const atomic = irys.utils.toAtomic(humanAmountStr);
  const receipt = await irys.fund(atomic, feeMultiplier);
  return {
    funded: irys.utils.fromAtomic(receipt.quantity),
    token: irys.token,
    txId: receipt.id,
  };
}

/**
 * Upload an object as JSON. Adds minimal tags for discoverability.
 * Returns { id, gatewayUrl }
 */
export async function uploadJson(obj, extraTags = []) {
  const irys = await getIrysUploader();

  const payload = JSON.stringify(obj);
  const size = new TextEncoder().encode(payload).length;

  // uploads < 100 KiB are free; otherwise lazy-fund for exact price
  const priceAtomic = await irys.getPrice(size);
  const needsFunding = priceAtomic.gt(0);

  if (needsFunding) {
    await irys.fund(priceAtomic); // lazy fund per upload
  }

  const tags = [
    { name: 'app', value: 'IrysPredict' },
    { name: 'content-type', value: 'application/json' },
    ...extraTags,
  ];

  const receipt = await irys.upload(payload, tags);
  return { id: receipt.id, gatewayUrl: `https://gateway.irys.xyz/${receipt.id}` };
}
