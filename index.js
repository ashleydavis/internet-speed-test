'use strict';

const fs = require('fs');
const papa = require('papaparse');
const api = require('fast-cli/api');
const moment = require('moment');
const cron = require('cron');
const timeseriesAggregate = require('timeseries-aggregate');

var outputFileName = "internet-speed-log.csv";

var inProgress = false;

var writeOutput = function (record) {
    if (fs.existsSync(outputFileName)) {
        fs.appendFileSync(outputFileName, "\r\n" + papa.unparse([record], { header: false }));
    } else {
        fs.writeFileSync(outputFileName, papa.unparse([record], { header: true }));
    }
};

var testRun = function() {

    var cronStart = new Date();
    var cronStartStr = moment(cronStart).format('YYYY-MM-DD HH:mm:ss');
    console.log("Executing cron job at: " + cronStartStr);

    if (inProgress) {
        console.log('Already in progress.')
        return;
    }

    inProgress = true;

    console.log("Querying Fast.com...");

    api().forEach(result => {
        if (result.isDone) {
            inProgress = false;

            var timeFinished = new Date();
            var dateFinishedStr = moment(timeFinished).format('YYYY-MM-DD');
            var timeFinishedStr = moment(timeFinished).format('HH:mm:ss');
            var testTimeSeconds = moment(timeFinished).diff(cronStart, 'seconds');

            var speed = result.downloadSpeed;

            if (result.unit === 'Kbps') {
                speed = speed / 1000;
            }

            var data = {
                Date: dateFinishedStr,
                Time: timeFinishedStr,
                SpeedMbps: speed,
                TestTimeSeconds: testTimeSeconds, 
            };

            console.log(data);

            writeOutput(data);
        }
    })
    .then(() => {
        console.log("Done querying Fast.com!");
    });
};

var CronJob = require('cron').CronJob;
new CronJob('0 */1 * * * *', testRun, null, true, 'Australia/Brisbane');

var express = require('express')
var app = express()

app.use(express.static('public'));

var aggregateSeries = function (data, period) {

    if (data.length === 0) {
        return [];
    }

    var periodMs = periodToMs(period);
    var periodStartDate = moment(data[0].Date).startOf(period).toDate(); 
    var periodEndDate = moment(periodStartDate).add(periodMs, 'milliseconds');
    var average = data[0].SpeedMbps;
    var low = data[0].SpeedMbps;
    var high = data[0].SpeedMbps;
    var open = data[0].SpeedMbps;
    var close = data[0].SpeedMbps;
    var workingIndex = 1;

    var averagedSeries = [];

    while (workingIndex < data.length) {
        var dataElement = data[workingIndex];
        var curDate = dataElement.Date;

        if (periodEndDate.isAfter(curDate)) {
            // Add to current average.
            average = (average + dataElement.SpeedMbps) / 2;
            low = Math.min(low, dataElement.SpeedMbps);
            high = Math.max(high, dataElement.SpeedMbps);
            close = dataElement.SpeedMbps;
        }
        else {
            averagedSeries.push({
                Date: periodEndDate.toDate(),
                SpeedMbps: average,
                Open: open,
                Close: close,
                Low: low,
                High: high,
            });

            // Start a new average.
            periodStartDate = periodEndDate.toDate();
            periodEndDate = moment(periodStartDate).add(periodMs, 'milliseconds');
            average = dataElement.SpeedMbps;
            low = dataElement.SpeedMbps;
            high = dataElement.SpeedMbps;
            open = dataElement.SpeedMbps;
            close = dataElement.SpeedMbps
        }

        ++workingIndex;
    }

    averagedSeries.push({
        Date: periodEndDate.toDate(),
        SpeedMbps: average,
        Open: open,
        Close: close,
        Low: low,
        High: high,
    });

    return averagedSeries;
};

var periods = {
    hour: 1 * 60 * 60 * 1000,
    day: 1 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
};

var periodToMs = function (period) {    
    if (periods[period]) {
        return periods[period];
    }

    throw new Error("Invalid period: " + period);
};

app.get('/internet-speed', (req, res) => {

    var data = [];

    try
    {
        if (fs.existsSync(outputFileName)) {
            data = papa.parse(fs.readFileSync(outputFileName, 'utf8'), {
                header: true,
                dynamicTyping: true,
            }).data;

            data.forEach(record => {
                // Merge date and time.
                record.Date = moment(record.Date + ' ' + record.Time, 'YYYY-MM-DD HH:mm:ss').toDate(),
                delete record.Time;
            });
        }

        if (req.query.period) {
            data = aggregateSeries(data, req.query.period);
        }
 
        res.json(data);
    }
    catch (err) {
        console.error(err && err.stack || err);
        res.sendStatus(500);
    }
});

app.listen(8000, function () {
    console.log('Example app listening on port 8000!')
});

testRun();
