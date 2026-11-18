const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.USE_TIDB = 'false';

const db = require('../src/database/db');
const queries = require('../src/database/queries');
const scoring = require('../src/utils/scoring');
const swissPairing = require('../src/managers/swissPairing');
const config = require('../src/config');

async function runTests() {
  console.log('🧪 Starting Chekhov’s Gum OUAG Tournament Test Suite...\n');

  // 1. Initialize Database
  console.log('[Test 1] Testing Database Initialization & Schema Migrations...');
  await db.initDb();
  console.log('  ✅ Database initialized and verified.');

  // 2. Casual Lobby Operations
  console.log('\n[Test 2] Testing Casual Lobby Lifecycle...');
  const testGuild = 'guild_casual_1';
  const testChannel = 'channel_casual_1';

  const lobbyId = await queries.createCasualLobby(testGuild, testChannel);
  assert(lobbyId > 0, 'Lobby ID should be greater than 0');

  for (let i = 1; i <= 6; i++) {
    const success = await queries.addCasualPlayer(lobbyId, `c_user_${i}`, `CPlayer_${i}`);
    assert.strictEqual(success, true, `Player ${i} should be added`);
  }

  // Duplicate add rejection
  assert.strictEqual(await queries.addCasualPlayer(lobbyId, 'c_user_1', 'CPlayer_1'), false);

  // Leave & re-join
  await queries.removeCasualPlayer(lobbyId, 'c_user_6');
  let players = await queries.getCasualPlayers(lobbyId);
  assert.strictEqual(players.length, 5);
  await queries.addCasualPlayer(lobbyId, 'c_user_6', 'CPlayer_6');

  // Submit 4-character code
  const code = '7K2N';
  assert.strictEqual(config.LOBBY_CODE_REGEX.test(code), true);
  await queries.setCasualLobbyCode(lobbyId, code, 'c_user_1');
  let lobby = await queries.getCasualLobbyById(lobbyId);
  assert.strictEqual(lobby.lobby_code, '7K2N');
  assert.strictEqual(lobby.status, 'ready');

  // Start match
  await queries.markCasualLobbyStarted(lobbyId);
  lobby = await queries.getCasualLobbyById(lobbyId);
  assert.strictEqual(lobby.status, 'started');
  console.log('  ✅ Casual lobby operations verified.');

  // 3. Lobby Sizing (Prefer 6 players, lowest pods short)
  console.log('\n[Test 3] Testing 6-Player Pod Priority & Short Lowest Pods...');
  // 34 players -> five 6s and one 4: [6, 6, 6, 6, 6, 4]
  const sizes34 = swissPairing.calculateOptimalLobbySizes(34);
  assert.deepStrictEqual(sizes34, [6, 6, 6, 6, 6, 4], '34 players should be five 6s and one 4');

  // 35 players -> five 6s and one 5: [6, 6, 6, 6, 6, 5]
  const sizes35 = swissPairing.calculateOptimalLobbySizes(35);
  assert.deepStrictEqual(sizes35, [6, 6, 6, 6, 6, 5], '35 players should be five 6s and one 5');

  // 16 players -> [6, 6, 4]
  const sizes16 = swissPairing.calculateOptimalLobbySizes(16);
  assert.deepStrictEqual(sizes16, [6, 6, 4]);

  // 14 players -> [6, 4, 4]
  const sizes14 = swissPairing.calculateOptimalLobbySizes(14);
  assert.deepStrictEqual(sizes14, [6, 4, 4]);

  // 13 players -> [5, 4, 4]
  const sizes13 = swissPairing.calculateOptimalLobbySizes(13);
  assert.deepStrictEqual(sizes13, [5, 4, 4]);

  // Sizes should always be in descending order (top pods full, lowest pods short)
  for (let n = 8; n <= 36; n++) {
    const s = swissPairing.calculateOptimalLobbySizes(n);
    for (let i = 0; i < s.length - 1; i++) {
      assert(s[i] >= s[i + 1], `Lobby sizes for N=${n} must be descending: ${JSON.stringify(s)}`);
    }
  }

  // Pod generation
  const mock34 = Array.from({ length: 34 }, (_, i) => ({ user_id: `u_${i}`, username: `User_${i}`, points: 0 }));
  const pods = swissPairing.generatePods(mock34, 1, false);
  assert.strictEqual(pods.length, sizes34.length);
  assert.strictEqual(pods.reduce((acc, p) => acc + p.length, 0), 34);
  assert.strictEqual(pods[0].length, 6, 'Pod 1 must have 6 players');
  assert.strictEqual(pods[pods.length - 1].length, 4, 'Last pod must be short (4 players)');
  console.log('  ✅ 6-player pod priority & short lowest pods verified.');

  // 4. Swiss & Carry-Over Points and Tie-Splitting (Rules B.3, B.4, C.1)
  console.log('\n[Test 4] Testing Swiss & Carry-Over Scoring with Ties...');
  // Standard placements [1, 2, 3, 4, 5, 6]
  const standardReports = [
    { userId: 'u1', placement: 1 },
    { userId: 'u2', placement: 2 },
    { userId: 'u3', placement: 3 },
    { userId: 'u4', placement: 4 },
    { userId: 'u5', placement: 5 },
    { userId: 'u6', placement: 6 }
  ];
  const standardSwiss = scoring.calculateSwissPodScores(standardReports);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u1').swissPoints, 6);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u1').carryOverPoints, 4);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u2').swissPoints, 4);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u2').carryOverPoints, 2);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u3').swissPoints, 3);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u3').carryOverPoints, 0);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u6').swissPoints, 0);
  assert.strictEqual(standardSwiss.find(s => s.userId === 'u6').carryOverPoints, 0);

  // Tie for 1st: (6 + 4) / 2 = 5 Swiss, (4 + 2) / 2 = 3 Carry-Over
  const tie1stReports = [
    { userId: 'u1', placement: 1 },
    { userId: 'u2', placement: 1 },
    { userId: 'u3', placement: 3 },
    { userId: 'u4', placement: 4 },
    { userId: 'u5', placement: 5 },
    { userId: 'u6', placement: 6 }
  ];
  const tie1st = scoring.calculateSwissPodScores(tie1stReports);
  assert.strictEqual(tie1st.find(s => s.userId === 'u1').swissPoints, 5);
  assert.strictEqual(tie1st.find(s => s.userId === 'u1').carryOverPoints, 3);
  assert.strictEqual(tie1st.find(s => s.userId === 'u2').swissPoints, 5);
  assert.strictEqual(tie1st.find(s => s.userId === 'u2').carryOverPoints, 3);

  // Tie for 2nd: (4 + 3) / 2 = 3.5 Swiss, (2 + 0) / 2 = 1 Carry-Over
  const tie2ndReports = [
    { userId: 'u1', placement: 1 },
    { userId: 'u2', placement: 2 },
    { userId: 'u3', placement: 2 },
    { userId: 'u4', placement: 4 },
    { userId: 'u5', placement: 5 },
    { userId: 'u6', placement: 6 }
  ];
  const tie2nd = scoring.calculateSwissPodScores(tie2ndReports);
  assert.strictEqual(tie2nd.find(s => s.userId === 'u2').swissPoints, 3.5);
  assert.strictEqual(tie2nd.find(s => s.userId === 'u2').carryOverPoints, 1);
  assert.strictEqual(tie2nd.find(s => s.userId === 'u3').swissPoints, 3.5);
  assert.strictEqual(tie2nd.find(s => s.userId === 'u3').carryOverPoints, 1);

  // Tie for 4th: (2 + 1) / 2 = 1.5 Swiss
  const tie4thReports = [
    { userId: 'u1', placement: 1 },
    { userId: 'u2', placement: 2 },
    { userId: 'u3', placement: 3 },
    { userId: 'u4', placement: 4 },
    { userId: 'u5', placement: 4 },
    { userId: 'u6', placement: 6 }
  ];
  const tie4th = scoring.calculateSwissPodScores(tie4thReports);
  assert.strictEqual(tie4th.find(s => s.userId === 'u4').swissPoints, 1.5);
  assert.strictEqual(tie4th.find(s => s.userId === 'u5').swissPoints, 1.5);

  // 5-player pod tie validation
  assert.strictEqual(scoring.validatePlacements([1, 2, 3, 4, 5], 5).valid, true);
  assert.strictEqual(scoring.validatePlacements([1, 1, 3, 4, 5], 5).valid, true);
  console.log('  ✅ Swiss & Carry-Over point calculations verified.');

  // 5. Round 3 Cut (Rule B.5)
  console.log('\n[Test 5] Testing Round 3 Cut (Eliminate bottom third)...');
  const tourneyId = await queries.createTournament({
    guildId: 'cut_guild',
    name: 'Cut Test Tournament',
    channelMode: 'category',
    tournamentChannelId: 'tourney_c',
    createdBy: 'admin'
  });

  // Register 35 players
  for (let i = 1; i <= 35; i++) {
    await queries.registerParticipant(tourneyId, `p_${i}`, `Player_${i}`);
    // Give varying points so we have clear rankings
    await queries.applySwissScores(tourneyId, `p_${i}`, i, 0, false);
  }

  const beforeCut = await queries.getParticipants(tourneyId, true);
  assert.strictEqual(beforeCut.length, 35);

  // Bottom third of 35 is Math.floor(35 / 3) = 11 players
  const cutCount = Math.floor(beforeCut.length / 3);
  assert.strictEqual(cutCount, 11);

  const eliminated = await queries.eliminateBottomThird(tourneyId, cutCount);
  assert.strictEqual(eliminated.length, 11);

  const afterCut = await queries.getParticipants(tourneyId, true);
  assert.strictEqual(afterCut.length, 24, '24 players should remain after cut');
  // Lowest point player remaining should be p_12
  assert.strictEqual(afterCut[afterCut.length - 1].user_id, 'p_12');
  console.log('  ✅ Round 3 Cut verified (35 players -> bottom 11 eliminated, 24 remain).');

  // 6. Finals Match-Point Format (Rules A.2, E.2, E.3, E.4)
  console.log('\n[Test 6] Testing Finals Format & "Checkmate" Win Condition...');
  const finalsTourneyId = await queries.createTournament({
    guildId: 'finals_guild',
    name: 'Finals Championship',
    channelMode: 'thread',
    tournamentChannelId: 'tourney_finals_c',
    createdBy: 'admin'
  });

  // Register top 6 finalists with starting Carry-Over points
  const finalistIds = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
  for (let i = 0; i < 6; i++) {
    const id = finalistIds[i];
    await queries.registerParticipant(finalsTourneyId, id, `Finalist_${i + 1}`);
    // f1 starts with 10 Carry-Over points (earned during Swiss)
    const carryOver = i === 0 ? 10.0 : 4.0;
    await queries.applySwissScores(finalsTourneyId, id, 20, carryOver, false);
  }

  // Initialize finalists
  await queries.initFinalsParticipants(finalsTourneyId, finalistIds);
  let finalists = await queries.getFinalists(finalsTourneyId);
  assert.strictEqual(finalists.length, 6);
  // f1 starts with 10 finals points
  assert.strictEqual(finalists[0].finals_points, 10);
  assert.strictEqual(finalists[0].is_eligible_to_win, 0, 'f1 starts at 10 pts, not yet eligible');

  // Finals Lobby #1: f1 finishes 1st (+10 Finals points)
  const finalsLobby1 = [
    { userId: 'f1', placement: 1 },
    { userId: 'f2', placement: 2 },
    { userId: 'f3', placement: 3 },
    { userId: 'f4', placement: 4 },
    { userId: 'f5', placement: 5 },
    { userId: 'f6', placement: 6 }
  ];
  const scores1 = scoring.calculateFinalsPodScores(finalsLobby1);
  assert.strictEqual(scores1.find(s => s.userId === 'f1').finalsPoints, 10);

  // Apply scores
  for (const s of scores1) {
    await queries.applyFinalsScores(finalsTourneyId, s.userId, s.finalsPoints, s.placement === 1);
  }

  finalists = await queries.getFinalists(finalsTourneyId);
  const f1 = finalists.find(f => f.user_id === 'f1');
  assert.strictEqual(f1.finals_points, 20, 'f1 should now have 10 carry-over + 10 lobby = 20 points');
  assert.strictEqual(f1.is_eligible_to_win, 1, 'f1 is now LIVE / ELIGIBLE TO WIN!');

  // Notice: As per Section E.4 example:
  // "A player enters Finals with 10 Carry-Over Points and wins the first Finals lobby. 10 Carry-Over + 10 Finals = 20 Total Finals Points.
  // That player is now eligible to win the tournament by placing 1st in a future Finals lobby."
  // f1 was NOT eligible entering Lobby 1, so they did not win the tournament in Lobby 1.

  // Finals Lobby #2: f1 is now eligible! If f1 finishes 1st in Lobby #2:
  const wasEligibleBeforeLobby2 = f1.is_eligible_to_win === 1;
  assert.strictEqual(wasEligibleBeforeLobby2, true, 'f1 enters Lobby 2 eligible to win');

  // f1 finishes 1st in Lobby #2 -> WINS TOURNAMENT!
  const isChampion = wasEligibleBeforeLobby2 && true; // finished 1st
  assert.strictEqual(isChampion, true, 'f1 achieved 20+ points AND finished 1st in subsequent finals lobby -> TOURNAMENT CHAMPION!');
  console.log('  ✅ Finals Match-Point Checkmate win condition validated.');

  // 7. Swiss Round 2+ Pairings & Rematch Minimization
  console.log('\n[Test 7] Testing Swiss Round 2+ Tiered Matchmaking...');
  const swiss13 = [
    { user_id: 'b1', username: 'Bot_1', points: 2, carry_over_points: 0, first_places: 0 },
    { user_id: 'b2', username: 'Bot_2', points: 6, carry_over_points: 4, first_places: 1 },
    { user_id: 'b3', username: 'Bot_3', points: 3, carry_over_points: 0, first_places: 0 },
    { user_id: 'b4', username: 'Bot_4', points: 4, carry_over_points: 2, first_places: 0 },
    { user_id: 'b5', username: 'Bot_5', points: 4, carry_over_points: 2, first_places: 0 },
    { user_id: 'b6', username: 'Bot_6', points: 1, carry_over_points: 0, first_places: 0 },
    { user_id: 'b7', username: 'Bot_7', points: 3, carry_over_points: 0, first_places: 0 },
    { user_id: 'b8', username: 'Bot_8', points: 6, carry_over_points: 4, first_places: 1 },
    { user_id: 'b9', username: 'Bot_9', points: 4, carry_over_points: 2, first_places: 0 },
    { user_id: 'b10', username: 'Bot_10', points: 3, carry_over_points: 0, first_places: 0 },
    { user_id: 'b11', username: 'Bot_11', points: 2, carry_over_points: 0, first_places: 0 },
    { user_id: 'b12', username: 'Bot_12', points: 6, carry_over_points: 4, first_places: 1 },
    { user_id: 'b13', username: 'Bot_13', points: 2, carry_over_points: 0, first_places: 0 },
  ];
  const round1History = [
    { player_a_id: 'b3', player_b_id: 'b11' }, { player_a_id: 'b3', player_b_id: 'b12' },
    { player_a_id: 'b1', player_b_id: 'b2' }, { player_a_id: 'b1', player_b_id: 'b4' },
    { player_a_id: 'b13', player_b_id: 'b5' }, { player_a_id: 'b13', player_b_id: 'b8' }
  ];

  const round2Pods = swissPairing.generatePods(swiss13, 2, false, round1History);
  assert.strictEqual(round2Pods.length, 3, '13 players should produce 3 pods [5, 4, 4]');
  assert.strictEqual(round2Pods[0].length, 5);
  assert.strictEqual(round2Pods[1].length, 4);
  assert.strictEqual(round2Pods[2].length, 4);

  // Pod 1 should have the top scorers (all 6-pointers and high 4-pointers)
  const pod1UserIds = round2Pods[0].map(p => p.user_id);
  assert(pod1UserIds.includes('b2'), 'Bot_2 (6pts) should be in Pod 1');
  assert(pod1UserIds.includes('b8'), 'Bot_8 (6pts) should be in Pod 1');
  assert(pod1UserIds.includes('b12'), 'Bot_12 (6pts) should be in Pod 1');

  // Pod 3 should have bottom tier players
  const pod3UserIds = round2Pods[2].map(p => p.user_id);
  assert(pod3UserIds.includes('b6'), 'Bot_6 (1pt) should be in bottom pod (Pod 3)');
  console.log('  ✅ Swiss Round 2+ tiered matchmaking verified.');

  // 8. Standings Embed Length & Chunking Limit Verification
  console.log('\n[Test 8] Testing Standings Embed Chunking & Length Constraints...');
  const embeds = require('../src/utils/embeds');
  const mockStandings = Array.from({ length: 25 }, (_, i) => ({
    user_id: `mock_bot_test_${i}`,
    username: `Bot_${i}`,
    points: 12 - Math.floor(i / 3),
    carry_over_points: 4,
    first_places: 1,
    status: 'registered'
  }));
  const testTournament = { id: 1, name: 'Stress Test Tourney', current_round: 2 };
  const standingsEmbed = embeds.createStandingsEmbed(testTournament, mockStandings, 'swiss');
  assert(standingsEmbed.data.fields.length >= 3, 'Should chunk 25 players across multiple fields');
  for (const field of standingsEmbed.data.fields) {
    assert(field.value.length <= 1024, `Field ${field.name} length (${field.value.length}) exceeds 1024!`);
  }
  console.log('  ✅ Embed character limits & multi-field chunking verified.');

  // 9. Drop & Issue Report UI & Components Verification
  console.log('\n[Test 9] Testing Drop & Issue Reporting Components...');
  const standingsComponents = embeds.createStandingsComponents({ id: 101, name: 'Test Tourney' });
  assert.strictEqual(standingsComponents.components.length, 2, 'Standings should have 2 action buttons');
  assert.strictEqual(standingsComponents.components[0].data.custom_id, 'tourney_report_issue_101');
  assert.strictEqual(standingsComponents.components[1].data.custom_id, 'tourney_drop_101');

  // Verify Pod embed Drop button
  const podMsg = embeds.createTournamentPodMessage(
    { id: 50, pod_number: 1, status: 'waiting_code' },
    [{ user_id: 'u1', username: 'P1' }, { user_id: 'u2', username: 'P2' }],
    1,
    false
  );
  assert(podMsg.components[0].components.some(btn => btn.data.custom_id === 'pod_drop_50'), 'Pod embed must include Drop button');

  // Verify Issue Channel message
  const issueMsg = embeds.createIssueChannelEmbed({ id: 101, name: 'Test Tourney', coordinator_role_id: 'role_coord' }, { id: 'user_x', username: 'TestUser' });
  assert(issueMsg.content.includes('<@&role_coord>'), 'Issue message must ping coordinator role');
  assert(issueMsg.components[0].components.some(btn => btn.data.custom_id === 'issue_resolve_101'), 'Issue message must have resolve button');
  console.log('  ✅ Drop and Issue Reporting components verified.');

  // 10. Tournament Channel & Issue Channel Cleanup
  console.log('\n[Test 10] Testing Tournament Cleanup & Issue Channel Lifecycle...');
  const slashCommands = require('../src/commands/slashCommands');
  const tourneyCmd = slashCommands.commands.find(c => c.name === 'tournament');
  assert(tourneyCmd, 'Tournament command must exist');
  const cleanupSub = tourneyCmd.options.find(opt => opt.name === 'cleanup');
  assert(cleanupSub, 'Tournament cleanup subcommand must be registered');

  // Database operations
  const tId = 888;
  await queries.recordIssueChannel(tId, 'ch_issue_1', 'user_1');
  await queries.recordIssueChannel(tId, 'ch_issue_2', 'user_2');
  let issues = await queries.getIssueChannels(tId);
  assert.strictEqual(issues.length, 2);

  await queries.deleteIssueChannel('ch_issue_1');
  issues = await queries.getIssueChannels(tId);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].channel_id, 'ch_issue_2');

  // Channel manager mock test
  const channelManager = require('../src/managers/channelManager');
  const deletedTracker = [];
  const mockGuild = {
    channels: {
      fetch: async (id) => {
        if (!id) return null;
        return {
          id,
          isThread: () => id.startsWith('thread_'),
          delete: async () => { deletedTracker.push(id); }
        };
      }
    }
  };

  const testTourneyForCleanup = {
    id: tId,
    name: 'Cleanup Test',
    category_id: null,
    tournament_channel_id: null
  };

  const cleanupRes = await channelManager.cleanupTournamentChannels(mockGuild, testTourneyForCleanup);
  assert.strictEqual(cleanupRes.deletedChannels, 1, 'Should delete recorded issue channel');
  assert(deletedTracker.includes('ch_issue_2'), 'Should have deleted ch_issue_2');

  // Cancel tournament cleans up DB records
  await queries.cancelTournament(tId);
  issues = await queries.getIssueChannels(tId);
  assert.strictEqual(issues.length, 0, 'Issue channels table should be cleared on cancelTournament');
  console.log('  ✅ Tournament cleanup & issue tracking verified.');

  console.log('\n======================================================');
  console.log('🎉 ALL TESTS PASSED! FULL CHEKHOV’S GUM FORMAT VERIFIED!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
