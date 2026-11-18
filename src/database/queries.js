const casualQueries = require('./casualQueries');
const tournamentQueries = require('./tournamentQueries');

module.exports = {
  ...casualQueries,
  ...tournamentQueries
};
