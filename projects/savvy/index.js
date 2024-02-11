const contracts = require("./contracts.json");
const { sumTokens2 } = require("../helper/unwrapLPs");
const sdk = require("@defillama/sdk");
const { getConfig } = require('../helper/cache');

function tvl(chain) {
  return async (timestamp, block, chainBlocks, { api }) => {

    //console.log("api", api);

    const savvyPositionManagers = (await sdk.api.abi.call({
      abi: 'function getSavvyPositionManagers() returns (address[] memory)',
      target: contracts.infoAggregator,
      chain: chain
    })).output;

    const yieldStrategyManagers = (await sdk.api.abi.multiCall({
      abi: 'address:yieldStrategyManager',
      calls: savvyPositionManagers.map((savvyPositionManager) => ({
        target: savvyPositionManager
      })),
      chain: chain
    })).output.map(y => y.output);

    //console.log("ysm", yieldStrategyManagers);

    const savvySages = (await sdk.api.abi.multiCall({
      abi: 'address:savvySage',
      calls: savvyPositionManagers.map((savvyPositionManager) => ({
        target: savvyPositionManager
      })),
      chain: chain
    })).output.map(y => y.output);

    const registeredBaseTokens = (await sdk.api.abi.multiCall({
      abi: 'function getRegisteredBaseTokens() returns (address[] memory)',
      calls: savvySages.map((savvySage) => ({
        target: savvySage
      })),
      chain: chain
    })).output.flatMap(r => {
        const target = r.input.target;
        const outputs = r.output;
        return outputs.map(output => [target, output]);
      });

    const savvySwaps = (await sdk.api.abi.multiCall({
      abi: 'function savvySwap(address baseToken) returns (address)',
      calls: registeredBaseTokens.map((r) => ({
        target: r[0],
        params: r[1]
      })),
      chain: chain
    })).output.map(y => y.output);

    const amos = (await sdk.api.abi.multiCall({
      abi: 'function amos(address baseToken) returns (address)',
      calls: registeredBaseTokens.map((r) => ({
        target: r[0],
        params: r[1]
      })),
      chain: chain
    })).output.map(y => y.output);

    const passThroughAMOs = (await sdk.api.abi.multiCall({
      abi: 'address:recipient',
      calls: amos.map((amo) => ({
        target: amo
      })),
      chain: chain,
      permitFailure: true
    })).output.filter(y => y.success).map(y => y.output);
    
    const baseTokens = (await sdk.api.abi.multiCall({
      abi: 'function getSupportedBaseTokens() returns (address[] memory)',
      calls: yieldStrategyManagers.map((yieldStrategyManager) => ({
        target: yieldStrategyManager
      })),
      chain: chain
    })).output.map(y => y.output).flat();

    const yieldTokens = (await sdk.api.abi.multiCall({
      abi: 'function getSupportedYieldTokens() returns (address[] memory)',
      calls: yieldStrategyManagers.map((yieldStrategyManager) => ({
        target: yieldStrategyManager
      })),
      chain: chain
    })).output.map(y => y.output).flat();

    //console.log("b", baseTokens);
    //console.log("y", yieldTokens);

    const aTokens = (await sdk.api.abi.multiCall({
      abi: 'address:aToken',
      calls: yieldTokens.map((yieldToken) => ({
        target: yieldToken
      })),
      chain: chain,
      permitFailure: true
    })).output.filter(y => y.success).map(y => y.output);

    const rTokens = (await sdk.api.abi.multiCall({
      abi: 'address:rToken',
      calls: yieldTokens.map((yieldToken) => ({
        target: yieldToken
      })),
      chain: chain,
      permitFailure: true
    })).output.filter(y => y.success).map(y => y.output);

    const yyTuples = (await sdk.api.abi.multiCall({
      abi: 'address:depositToken',
      calls: yieldTokens.map((yieldToken) => ({
        target: yieldToken
      })),
      chain: chain,
      permitFailure: true
    })).output.filter(y => y.success).map(y => [y.input.target, y.output]);
    const yyValues = (await sdk.api.abi.multiCall({
      abi: 'uint256:totalDeposits',
      calls: yyTuples.map((yyTuple) => ({
        target: yyTuple[0]
      })),
      chain: chain,
      permitFailure: true
    })).output.map(y => y.output);

    yyTuples.forEach((yyTuple, i) => {
      api.add(yyTuple[1], yyValues[i]);
    })

    console.log("yyT", yyTuples);
    console.log("yyV", yyValues);

    //const tokens = await api.multiCall({ abi: 'address:depositToken', calls: farms.map(i => i.address), permitFailure: true, })
    //const vals = await api.multiCall({ abi: 'uint256:totalDeposits', calls: farms.map(i => i.address), permitFailure: true, })

    //used for wrapped jUDSC & stargate yield tokens
    const underlyingTokens = (await sdk.api.abi.multiCall({
      abi: 'address:token',
      calls: yieldTokens.map((yieldToken) => ({
        target: yieldToken
      })),
      chain: chain,
      permitFailure: true
    })).output.filter(y => y.success).map(y => y.output);

    const tokenHolders = [...new Set(savvyPositionManagers.concat(yieldStrategyManagers).concat(savvySages)
      .concat(savvySwaps).concat(amos).concat(passThroughAMOs).concat(yieldTokens).filter(h => parseInt(h, 16) !== 0))];
    const tokens = [...new Set(baseTokens.concat(yieldTokens).concat(aTokens).concat(rTokens).concat(underlyingTokens)
      .filter(h => parseInt(h, 16) !== 0))];
    
    //await setTvlYieldYak(api);

    await sumTokens2({ tokens, api, owners: tokenHolders });
  };
}

async function setTvlYieldYak(api) {
  const farms = await getConfig('yieldyak/arbi', 'https://staging-api.yieldyak.com/42161/farms')
  const tokens = await api.multiCall({ abi: 'address:depositToken', calls: farms.map(i => i.address), permitFailure: true, });
  const vals = await api.multiCall({ abi: 'uint256:totalDeposits', calls: farms.map(i => i.address), permitFailure: true, });
  //console.log("farm", farms);
  //console.log("tokens", tokens);
  //console.log("vals", vals);
  tokens.forEach((token, i) => {
    if (!token || !vals[i]) return;
    api.add(token, vals[i]);
  })
}

module.exports = {
  methodology: 'The calculated TVL is the current sum of all base tokens and yield tokens in our contracts.',
  arbitrum: {
    tvl: tvl("arbitrum")
  },
  hallmarks: [
    [1691473498, "LBP Launch"]
  ]
}