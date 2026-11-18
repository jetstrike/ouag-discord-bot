const config = require('../config');

/**
 * Shuffles an array randomly using Fisher-Yates.
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Calculates lobby sizes prioritizing 6-player pods where possible, leaving the
 * lowest point pods (at the end) short on users (4 or 5 players).
 * Priority:
 * 1. Maximize count of 6-player pods.
 * 2. Next, maximize count of 5-player pods (minimizing 4s).
 * 3. Return sizes sorted descending [6, ..., 5, ..., 4] so top pods are full
 *    and lowest pods are short.
 * 
 * Example: 34 players -> [6, 6, 6, 6, 6, 4]
 * Example: 16 players -> [6, 6, 4]
 * Example: 14 players -> [6, 4, 4]
 * Example: 13 players -> [5, 4, 4]
 * 
 * @param {number} N Total player count
 * @param {number} minSize Default 4
 * @param {number} maxSize Default 6
 * @returns {number[]} Array of lobby sizes
 */
function calculateOptimalLobbySizes(N, minSize = 4, maxSize = 6) {
  if (N <= 0) return [];
  if (N <= maxSize) return [N];

  // Maximize count of maxSize (6), then (maxSize - 1) (5), with all sizes in [minSize, maxSize]
  const max6 = Math.floor(N / maxSize);
  for (let c6 = max6; c6 >= 0; c6--) {
    const rem6 = N - c6 * maxSize;
    const max5 = Math.floor(rem6 / 5);
    for (let c5 = max5; c5 >= 0; c5--) {
      const rem5 = rem6 - c5 * 5;
      if (rem5 % minSize === 0) {
        const c4 = rem5 / minSize;
        return [
          ...Array(c6).fill(maxSize),
          ...Array(c5).fill(5),
          ...Array(c4).fill(minSize)
        ];
      }
    }
  }

  // Fallback for counts like N = 7: split into 2 pods [Math.ceil(N/2), Math.floor(N/2)]
  if (N < minSize * 2) {
    return [Math.ceil(N / 2), Math.floor(N / 2)];
  }

  const sizes = [];
  let rem = N;
  while (rem > 0) {
    const take = Math.min(maxSize, rem);
    sizes.push(take);
    rem -= take;
  }
  return sizes.sort((a, b) => b - a);
}

/**
 * Builds a fast lookup key for pairs of user IDs.
 */
function pairKey(idA, idB) {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

/**
 * Generates tournament pods according to Swiss rules & Chekhov's Gum balanced sizes:
 * - Round 1 (Rule B.1): Initial seeding is generated randomly.
 * - Round 2+ (Swiss Matchmaking): Players are sorted by performance (Swiss points DESC,
 *   Carry-Over points DESC, first_places DESC), grouped into score brackets, and partitioned
 *   into optimal balanced lobby sizes (Rule B.2).
 * - Rematch Minimization: Prior matchups from previous rounds are minimized by performing
 *   swaps among tied or score-adjacent players.
 * - Finals: Exactly 1 pod with the 6 qualified finalists.
 * 
 * @param {Array<{user_id: string, username: string, points: number, carry_over_points?: number, first_places?: number}>} participants 
 * @param {number} roundNumber 
 * @param {boolean} [isFinals=false] 
 * @param {Array<{player_a_id: string, player_b_id: string}>} [matchupHistory=[]]
 * @returns {Array<Array<{user_id: string, username: string, points: number}>>}
 */
function generatePods(participants, roundNumber = 1, isFinals = false, matchupHistory = []) {
  const totalPlayers = participants.length;
  if (totalPlayers === 0) return [];

  // Finals: Single 6-player pod
  if (isFinals) {
    return [participants.slice(0, config.TOURNAMENT_RULES.FINALS_QUALIFIERS)];
  }

  // Rule B.2: Balanced lobby sizes
  const lobbySizes = calculateOptimalLobbySizes(totalPlayers, config.MIN_LOBBY_SIZE, config.MAX_LOBBY_SIZE);

  // Round 1: Completely random seeding (Rule B.1)
  if (roundNumber <= 1) {
    const shuffled = shuffleArray(participants);
    const pods = [];
    let playerOffset = 0;
    for (const size of lobbySizes) {
      pods.push(shuffled.slice(playerOffset, playerOffset + size));
      playerOffset += size;
    }
    return pods;
  }

  // Round 2+: True Swiss pairing by score tiers with rematch minimization
  // 1. Build lookup Set for previous matchups
  const matchupSet = new Set();
  if (Array.isArray(matchupHistory)) {
    for (const m of matchupHistory) {
      const p1 = m.player_a_id || m.p1;
      const p2 = m.player_b_id || m.p2;
      if (p1 && p2) {
        matchupSet.add(pairKey(p1, p2));
      }
    }
  }

  // 2. Sort participants: points DESC, carry_over_points DESC, first_places DESC
  // Add slight random tiebreak so equal scores have variety
  const sorted = [...participants].sort((a, b) => {
    const ptsA = Number(a.points) || 0;
    const ptsB = Number(b.points) || 0;
    if (ptsB !== ptsA) return ptsB - ptsA;

    const coA = Number(a.carry_over_points) || 0;
    const coB = Number(b.carry_over_points) || 0;
    if (coB !== coA) return coB - coA;

    const fpA = Number(a.first_places) || 0;
    const fpB = Number(b.first_places) || 0;
    if (fpB !== fpA) return fpB - fpA;

    return Math.random() - 0.5;
  });

  // 3. Partition into initial pods according to optimal sizes
  const pods = [];
  let playerOffset = 0;
  for (const size of lobbySizes) {
    pods.push(sorted.slice(playerOffset, playerOffset + size));
    playerOffset += size;
  }

  // 4. Rematch minimization optimization
  function countPodRematches(pod) {
    let rematches = 0;
    for (let i = 0; i < pod.length; i++) {
      for (let j = i + 1; j < pod.length; j++) {
        if (matchupSet.has(pairKey(pod[i].user_id, pod[j].user_id))) {
          rematches++;
        }
      }
    }
    return rematches;
  }

  function getScore(currentPods) {
    let totalRematches = 0;
    let inversions = 0;
    for (let pi = 0; pi < currentPods.length; pi++) {
      totalRematches += countPodRematches(currentPods[pi]);
      for (let pj = pi + 1; pj < currentPods.length; pj++) {
        for (const pA of currentPods[pi]) {
          for (const pB of currentPods[pj]) {
            const pDiff = (Number(pB.points) || 0) - (Number(pA.points) || 0);
            if (pDiff > 0) {
              inversions += pDiff;
            }
          }
        }
      }
    }
    // Prioritize preserving Swiss score tiers first and foremost, then minimizing rematches
    return totalRematches * 100 + inversions * 2000;
  }

  let currentScore = getScore(pods);
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 100;

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;

    for (let i = 0; i < pods.length; i++) {
      for (let j = i + 1; j < pods.length; j++) {
        for (let aIdx = 0; aIdx < pods[i].length; aIdx++) {
          for (let bIdx = 0; bIdx < pods[j].length; bIdx++) {
            const pA = pods[i][aIdx];
            const pB = pods[j][bIdx];

            // Strict Swiss tiering: only swap if same points (pure tie) or adjacent pods with max 1pt diff
            const pointDiff = Math.abs((Number(pA.points) || 0) - (Number(pB.points) || 0));
            if (pointDiff > 1 || Math.abs(i - j) > 1) continue;

            // Try swap
            pods[i][aIdx] = pB;
            pods[j][bIdx] = pA;

            const newScore = getScore(pods);
            if (newScore < currentScore) {
              currentScore = newScore;
              improved = true;
            } else {
              // Revert
              pods[i][aIdx] = pA;
              pods[j][bIdx] = pB;
            }
          }
        }
      }
    }
  }

  return pods;
}

module.exports = {
  calculateOptimalLobbySizes,
  generatePods,
  pairKey,
  shuffleArray
};
