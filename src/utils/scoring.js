const config = require('../config');

/**
 * Computes the points awarded to each player in a pod, accurately handling ties.
 * 
 * @param {Array<{userId: string, placement: number}>} playerReports 
 * @param {number[]} pointsTable - array of points for 1st to Nth
 * @returns {Array<{userId: string, placement: number, points: number}>}
 */
function calculateSplitPoints(playerReports, pointsTable) {
  let table = pointsTable;
  if (typeof table === 'string') {
    try {
      table = JSON.parse(table);
    } catch (e) {
      table = config.TOURNAMENT_RULES.SWISS_POINTS;
    }
  }
  if (!Array.isArray(table)) {
    table = config.TOURNAMENT_RULES.SWISS_POINTS;
  }

  const sorted = [...playerReports].sort((a, b) => a.placement - b.placement);
  
  // Group players by reported rank
  const groups = new Map();
  for (const p of sorted) {
    if (!groups.has(p.placement)) {
      groups.set(p.placement, []);
    }
    groups.get(p.placement).push(p);
  }

  const results = [];
  let currentRankIndex = 0; // 0-indexed position in pointsTable

  const distinctPlacements = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const placement of distinctPlacements) {
    const tiedPlayers = groups.get(placement);
    const count = tiedPlayers.length;

    // Sum points for the positions these tied players occupy
    let totalPoints = 0;
    for (let i = 0; i < count; i++) {
      const idx = currentRankIndex + i;
      totalPoints += (idx < table.length ? Number(table[idx]) : 0);
    }

    const splitPoints = Math.round((totalPoints / count) * 100) / 100;

    for (const player of tiedPlayers) {
      const uid = player.userId || player.user_id;
      results.push({
        userId: uid,
        user_id: uid,
        placement: placement,
        points: splitPoints
      });
    }

    currentRankIndex += count;
  }

  return results;
}

/**
 * Computes both Swiss Points and Carry-Over Points for a Swiss match pod.
 * 
 * @param {Array<{userId: string, placement: number}>} playerReports 
 * @param {number[]|string} [customSwissPoints]
 * @returns {Array<{userId: string, placement: number, swissPoints: number, carryOverPoints: number}>}
 */
function calculateSwissPodScores(playerReports, customSwissPoints = null) {
  let swissTable = customSwissPoints;
  if (typeof swissTable === 'string') {
    try {
      swissTable = JSON.parse(swissTable);
    } catch (e) {
      swissTable = config.TOURNAMENT_RULES.SWISS_POINTS;
    }
  }
  if (!Array.isArray(swissTable)) {
    swissTable = config.TOURNAMENT_RULES.SWISS_POINTS;
  }

  const carryOverTable = config.TOURNAMENT_RULES.CARRY_OVER_POINTS;

  const swissScores = calculateSplitPoints(playerReports, swissTable);
  const carryOverScores = calculateSplitPoints(playerReports, carryOverTable);

  const carryMap = new Map();
  for (const c of carryOverScores) {
    const uid = c.userId || c.user_id;
    carryMap.set(uid, c.points);
  }

  return swissScores.map(s => {
    const uid = s.userId || s.user_id;
    return {
      userId: uid,
      user_id: uid,
      placement: s.placement,
      swissPoints: s.points,
      carryOverPoints: carryMap.get(uid) || 0.0
    };
  });
}

/**
 * Computes Finals Points for a Finals match pod.
 * 
 * @param {Array<{userId: string, placement: number}>} playerReports 
 * @returns {Array<{userId: string, placement: number, finalsPoints: number}>}
 */
function calculateFinalsPodScores(playerReports) {
  const finalsTable = config.TOURNAMENT_RULES.FINALS_POINTS;
  const finalsScores = calculateSplitPoints(playerReports, finalsTable);
  return finalsScores.map(s => {
    const uid = s.userId || s.user_id;
    return {
      userId: uid,
      user_id: uid,
      placement: s.placement,
      finalsPoints: s.points
    };
  });
}

/**
 * Validates a set of placements with tie support for any pod size.
 * For example:
 * [1, 2, 3, 4, 5, 6] -> valid
 * [1, 1, 3, 4, 5, 6] -> valid (2 players tied for 1st, next is 3rd)
 * [1, 2, 2, 2, 5] -> valid for 5 players (3 players tied for 2nd, next is 5th)
 */
function validatePlacements(placements, expectedCount = 6) {
  if (!Array.isArray(placements) || placements.length !== expectedCount) {
    return { valid: false, error: `Expected exactly ${expectedCount} player placements, but received ${placements?.length || 0}.` };
  }

  const sorted = [...placements].sort((a, b) => a - b);

  if (sorted[0] < 1 || sorted[sorted.length - 1] > expectedCount) {
    return { valid: false, error: `Placements must be between 1 and ${expectedCount}.` };
  }

  // Verify rank progression with ties
  let expectedNextRank = 1;
  let i = 0;
  while (i < sorted.length) {
    const currentRank = sorted[i];
    if (currentRank !== expectedNextRank) {
      return { 
        valid: false, 
        error: `Invalid placement progression. Rank ${expectedNextRank} was expected, but found ${currentRank}. Check for tie gaps.` 
      };
    }
    let tieCount = 0;
    while (i < sorted.length && sorted[i] === currentRank) {
      tieCount++;
      i++;
    }
    expectedNextRank += tieCount;
  }

  return { valid: true };
}

module.exports = {
  calculateSplitPoints,
  calculateSwissPodScores,
  calculateFinalsPodScores,
  validatePlacements
};
