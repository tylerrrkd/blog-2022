const { format } = require('date-fns');

module.exports = (date) => format(date, 'yyyy/MM/dd');
