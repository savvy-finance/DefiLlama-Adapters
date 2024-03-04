const contracts = require("./contracts.json");
const { sumTokens2, nullAddress } = require("../helper/unwrapLPs");

async function tvl(timestamp, block, chainBlocks, { api }) {
  const savvyPositionManagers = await api.call({
    abi: "address[]:getSavvyPositionManagers",
    target: contracts.infoAggregator,
  });
  // console.log("savvyPositionManagers:", savvyPositionManagers);

  const yieldStrategyManagers = await api.multiCall({
    abi: "address:yieldStrategyManager",
    calls: savvyPositionManagers,
  });
  // console.log("yieldStrategyManagers:", yieldStrategyManagers);

  const savvySages = await api.multiCall({
    abi: "address:savvySage",
    calls: savvyPositionManagers,
  });
  // console.log("savvySages:", savvySages);

  const registeredBaseTokensCalls = (
    await api.multiCall({
      abi: "address[]:getRegisteredBaseTokens",
      calls: savvySages,
    })
  ).flatMap((r, i) => {
    const target = savvySages[i];
    return r.map((params) => ({ target, params }));
  });
  // console.log("registeredBaseTokensCalls:", registeredBaseTokensCalls);

  const savvySwaps = await api.multiCall({
    abi: "function savvySwap(address baseToken) returns (address)",
    calls: registeredBaseTokensCalls,
  });
  // console.log("savvySwaps:", savvySwaps);

  const amos = await api.multiCall({
    abi: "function amos(address baseToken) returns (address)",
    calls: registeredBaseTokensCalls,
  });
  // console.log("amos:", amos);

  const passThroughAMOs = (
    await api.multiCall({
      abi: "address:recipient",
      calls: amos,
      permitFailure: true,
    })
  ).filter((y) => y);
  // console.log("passThroughAMOs:", passThroughAMOs);

  const baseTokens = (
    await api.multiCall({
      abi: "address[]:getSupportedBaseTokens",
      calls: yieldStrategyManagers,
    })
  ).map((y) => y);
  // console.log("baseTokens:", baseTokens);

  const yieldTokens = (
    await api.multiCall({
      abi: "address[]:getSupportedYieldTokens",
      calls: yieldStrategyManagers,
    })
  ).map((y) => y);
  // console.log("yieldTokens:", yieldTokens);

  const aTokens = (
    await api.multiCall({
      abi: "address:aToken",
      calls: yieldTokens,
      permitFailure: true,
    })
  ).filter((y) => y);
  // console.log("aTokens:", aTokens);

  const rTokens = (
    await api.multiCall({
      abi: "address:rToken",
      calls: yieldTokens,
      permitFailure: true,
    })
  ).filter((y) => y);
  // console.log("rTokens:", rTokens);

  const underlyingTokens = (
    await api.multiCall({
      abi: "address:token",
      calls: yieldTokens,
      permitFailure: true,
    })
  ).filter((y) => y);
  // console.log("underlyingTokens:", underlyingTokens);

  const tokens = [
    baseTokens,
    underlyingTokens,
    yieldTokens,
    contracts.arb,
  ].flat(4);
  // console.log("tokens:", tokens);

  const tokenHolders = [savvyPositionManagers, savvySages, passThroughAMOs]
    .flat(4)
    .filter((i) => i !== nullAddress);
  // console.log("tokenHolders:", tokenHolders);

  const tokensAndOwners = tokenHolders
    .map((owner) => tokens.map((token) => [token, owner]))
    .flat();
  // console.log("tokensAndOwners:", tokensAndOwners);

  const name1 = await api.multiCall({
    abi: "string:name",
    calls: tokens,
    permitFailure: true,
  });
  // console.log("name1:", name1);

  const ownYieldTokens = tokens.filter(
    (_, i) => name1[i] && name1[i].toLowerCase().includes("savvy yield")
  );
  // console.log("name1:", name1);

  const oyTokens = await api.multiCall({
    abi: "address:aToken",
    calls: ownYieldTokens,
    permitFailure: true,
  });
  // console.log("name1:", name1);

  const oybTokens = await api.multiCall({
    abi: "address:baseToken",
    calls: ownYieldTokens,
    permitFailure: true,
  });
  // console.log("name1:", name1);

  ownYieldTokens.forEach((_, i) => {
    if (oyTokens[i]) tokensAndOwners.push([oyTokens[i], ownYieldTokens[i]]);
    if (oybTokens[i]) tokensAndOwners.push([oybTokens[i], ownYieldTokens[i]]);
  });
  // console.log("tokensAndOwners:", tokensAndOwners);

  await sumTokens2({
    tokens,
    api,
    tokensAndOwners,
    blacklistedTokens: ownYieldTokens,
  });
}

module.exports = {
  methodology:
    "The calculated TVL is the current sum of all base tokens and yield tokens in our contracts.",
  arbitrum: {
    tvl,
  },
  hallmarks: [[1691473498, "LBP Launch"]],
};
