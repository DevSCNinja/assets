import {
    readDirSync,
    isPathExistsSync
} from "../generic/filesystem";
import { CheckStepInterface, ActionInterface } from "../generic/interface";
import {
    allChains,
    dappsPath,
    getChainLogoPath,
    getChainAssetInfoPath,
    getChainAssetsPath,
    getChainAssetPath,
    getChainAssetLogoPath,
    assetFolderAllowedFiles,
    getChainFolderFilesList,
    chainFolderAllowedFiles,
    rootDirAllowedFiles
} from "../generic/repo-structure";
import { isLogoOK } from "../generic/image";
import { isLowerCase } from "../generic/types";
import * as bluebird from "bluebird";
import axios from "axios";
import { explorerUrl } from "./asset-infos";
import { writeJsonFile } from "./json";

export function safeParseInt(value: string): number {
    try {
        const num: number = parseInt(value, 10);
        if (num === NaN || !num) {
            return 0;
        }
        return num;
    } catch (err) {
        return 0;
    }
}

async function fetchBackend(url: string): Promise<[number, string]> {
    const resp = await axios.get(url);
    if (resp.status != 200) {
        console.log("ERROR: Non-OK status", resp.status, resp.statusText, url);
        return [resp.status, ""];
    }
    let text: string = "";
    try {
        text = JSON.stringify(resp.data);
    } catch (error) {
        text = resp.data;
    }
    return [resp.status, text]
}

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

async function callEthplorerApi(url: string): Promise<unknown> {
    await delay(2000);
    const [status, text] = await fetchBackend(url);
    if (status != 200) {
        console.log("ERROR: Non-OK status", status, url);
        return {};
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
        console.log("error", error)
    }
}

const ethplorerApiUrl = "https://api.ethplorer.io";
const ethplorerApiKey = "freekey";

async function getTokenInfoEthplorer(token: string): Promise<unknown> {
    const url = `${ethplorerApiUrl}/getTokenInfo/${token}?apiKey=${ethplorerApiKey}`;
    const data = await callEthplorerApi(url);
    console.log(data);
    /*
        address: '0x164adc5e46324a9d5fc520f0f753b62dd01dc556',
        decimals: '3963877391197344453575983046348115674221700746820753546331534351508065746944',
        owner: '0xa516da2fdbeb58c82ad0ae84bf51669c0ca467d3',
        totalSupply: '3963877391197344453575983046348115674221700746820753546331534351508065746944',
        transfersCount: 0,
        lastUpdated: 1596791817,
        issuancesCount: 0,
        holdersCount: 9,
        ethTransfersCount: 0,
        symbol: '',
        price: false,
        countOps: 0
    */
    return data;
    /*
    return {
        symbol: data['symbol'],
        decimals: safeParseInt(data['decimals']),
        holdersCount: data['holdersCount'],
        transfersCount: data['transfersCount'],
        name: data['name'],
        website: data['website'],
        facebook: data['facebook'],
        twitter: data['twitter'],
    }
    */
}

async function createInfoJsonEth(tokenInfo: unknown): Promise<void> {
    /*
        address: '0x02ec0c9e6d3c08b8fb12fec51ccba048afbc36a6',
        name: 'Stable Set',
        decimals: '18',
        symbol: 'STBL',
        totalSupply: '20788750425660091770',
        owner: '',
        transfersCount: 31,
        lastUpdated: 1572801110,
        issuancesCount: 0,
        holdersCount: 6,
        ethTransfersCount: 0,
        price: false,
        countOps: 31
    */
    //console.log(tokenInfo);
    const assetId = tokenInfo['address'];
    const info = {
        name: tokenInfo['name'],
        type: "ERC20",
        symbol: tokenInfo['symbol'],
        decimals:  safeParseInt(tokenInfo['decimals']),
        website: '',
        description: '-',
        explorer: explorerUrl('ethereum', assetId),
        status: 'active',
        id: assetId
    };
    const infoPath = getChainAssetInfoPath('ethereum', assetId);
    writeJsonFile(infoPath, info);
}

export class FoldersFiles implements ActionInterface {
    getName(): string { return "Folders and Files"; }
    
    getSanityChecks(): CheckStepInterface[] {
        return [
            {
                getName: () => { return "Repository root dir"},
                check: async () => {
                    const errors: string[] = [];
                    const dirActualFiles = readDirSync(".");
                    dirActualFiles.forEach(file => {
                        if (!(rootDirAllowedFiles.indexOf(file) >= 0)) {
                            errors.push(`File "${file}" should not be in root or added to predifined list`);
                        }
                    });
                    return [errors, []];
                }
            },
            {
                getName: () => { return "Chain folders are lowercase, contain only predefined list of files"},
                check: async () => {
                    const errors: string[] = [];
                    allChains.forEach(chain => {
                        if (!isLowerCase(chain)) {
                            errors.push(`Chain folder must be in lowercase "${chain}"`);
                        }
                        getChainFolderFilesList(chain).forEach(file => {
                            if (!(chainFolderAllowedFiles.indexOf(file) >= 0)) {
                                errors.push(`File '${file}' not allowed in chain folder: ${chain}`);
                            }
                        });
                    });
                    return [errors, []];
                }
            },
            {
                getName: () => { return "Chain folders have logo, and correct size"},
                check: async () => {
                    const errors: string[] = [];
                    await bluebird.each(allChains, async (chain) => {
                        const chainLogoPath = getChainLogoPath(chain);
                        if (!isPathExistsSync(chainLogoPath)) {
                            errors.push(`File missing at path "${chainLogoPath}"`);
                        }
                        const [isOk, error1] = await isLogoOK(chainLogoPath);
                        if (!isOk) {
                            errors.push(error1);
                        }
                    });
                    return [errors, []];
                }
            },
            {
                getName: () => { return "Asset folders contain logo and info"},
                check: async () => {
                    const errors: string[] = [];
                    const warnings: string[] = [];
                    //allChains.forEach((chain) => {
                    await bluebird.each(allChains, async (chain) => {
                        const assetsPath = getChainAssetsPath(chain);
                        if (isPathExistsSync(assetsPath)) {
                            const assets = readDirSync(assetsPath);
                            //assets.forEach(address => {
                            await bluebird.each(assets, async (address) => {
                                const logoFullPath = getChainAssetLogoPath(chain, address);
                                if (!isPathExistsSync(logoFullPath)) {
                                    errors.push(`Missing logo file for asset '${chain}/${address}' -- ${logoFullPath}`);
                                }
                                const infoFullPath = getChainAssetInfoPath(chain, address);
                                if (!isPathExistsSync(infoFullPath)) {
                                    if (chain === 'smartchain') {
                                        console.log('Missing   ', chain, address, infoFullPath);
                                        console.log('{');
                                        console.log(`    "name": ""`);
                                        console.log(`    "type": "${chain}"`);
                                        console.log(`    "symbol": ""`);
                                        console.log(`    "decimals": 0`);
                                        console.log(`    "website": ""`);
                                        console.log(`    "description": "-"`);
                                        const expl = explorerUrl(chain, address);
                                        console.log(`    "explorer": "${expl}"`);
                                        console.log(`    "status": "active"`);
                                        console.log(`    "id": "${address}"`);
                                        console.log('}');
                                    }
                                    /*
                                    if (chain === 'ethereum') {
                                        try {
                                            //console.log('Ethereum');
                                            const tokenInfo = await getTokenInfoEthplorer(address);
                                            //console.log(tokenInfo);
                                            createInfoJsonEth(tokenInfo);
                                        } catch (ex) {
                                            console.log(ex.toString().substring(0, 300-1));
                                        }
                                    }
                                    */
                                    const msg = `Missing info file for asset '${chain}/${address}' -- ${infoFullPath}`;
                                    console.log(msg);
                                    warnings.push(msg);
                                }
                            });
                        }
                    });
                    return [errors, warnings];
                }
            },
            /*
            {
                getName: () => { return "Asset folders contain info.json"},
                check: async () => {
                    const warnings: string[] = [];
                    allChains.forEach(chain => {
                        const assetsPath = getChainAssetsPath(chain);
                        if (isPathExistsSync(assetsPath)) {
                            readDirSync(assetsPath).forEach(address => {
                                const infoFullPath = getChainAssetInfoPath(chain, address);
                                if (!isPathExistsSync(infoFullPath)) {
                                    warnings.push(`Missing info file for asset '${chain}/${address}' -- ${infoFullPath}`);
                                }
                            });
                        }
                    });
                    return [[], warnings];
                }
            },
            */
            {
                getName: () => { return "Asset folders contain only predefined set of files"},
                check: async () => {
                    const errors: string[] = [];
                    allChains.forEach(chain => {
                        const assetsPath = getChainAssetsPath(chain);
                        if (isPathExistsSync(assetsPath)) {
                            readDirSync(assetsPath).forEach(address => {
                                const assetFiles = getChainAssetPath(chain, address);
                                readDirSync(assetFiles).forEach(assetFolderFile => {
                                    if (!(assetFolderAllowedFiles.indexOf(assetFolderFile) >= 0)) {
                                        errors.push(`File '${assetFolderFile}' not allowed at this path: ${assetsPath}`);
                                    }
                                });
                            });
                        }
                    });
                    return [errors, []];
                }
            },
            {
                getName: () => { return "Dapps folders contain only .png files, with all lowercase names"},
                check: async () => {
                    const errors: string[] = [];
                    if (isPathExistsSync(dappsPath)) {
                        readDirSync(dappsPath).forEach(filename => {
                            if (!filename.endsWith('.png')) {
                                errors.push(`File '${filename}' has invalid extension; ${dappsPath}`);
                            }
                            if (filename.toLowerCase() != filename) {
                                errors.push(`File '${filename}' is not all-lowercase; ${dappsPath}`);
                            }
                        });
                    }
                    return [errors, []];
                }
            }
        ];
    }
}
