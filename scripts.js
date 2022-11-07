// https://stackoverflow.com/a/34270811
function forHumans ( seconds ) {
    var levels = [
        [Math.floor(seconds / 31536000), 'years'],
        [Math.floor((seconds % 31536000) / 86400), 'days'],
        [Math.floor(((seconds % 31536000) % 86400) / 3600), 'hours'],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), 'minutes'],
        [(((seconds % 31536000) % 86400) % 3600) % 60, 'seconds'],
    ];
    var returntext = '';

    for (var i = 0, max = levels.length; i < max; i++) {
        if ( levels[i][0] === 0 ) continue;
        if (i == max-1) returntext += ' and';

        returntext += ' ' + levels[i][0] + ' ' + (levels[i][0] === 1 ? levels[i][1].substr(0, levels[i][1].length-1): levels[i][1]);
    };
    return returntext.trim();
}

var logsSmth = function(text) {
    document.getElementById("logs").innerHTML = text
}

var fetchViewingActivity = function(page, pageSize) {
    logsSmth("Fetching page " + page + " of your Netflix history...")
    fetch(`https://netflix.com/api/shakti/mre/viewingactivity?pg=${page}&pgSize=${pageSize}`)
        .then((resp) => {
            if (resp.status === 200) {
                return resp.json()
            } else {
                logsSmth("Error fetching your Netflix history.<br>Please check that you are logged in and try again later.")
                throw new Error("Code " + resp.status + " while fetching Netflix history.")
            }
        })
        .then((data) => {
            if (data.viewedItems.length !== 0) {
                Array.prototype.push.apply(allViewed, data.viewedItems);
                fetchViewingActivity(page+1, pageSize);
            } else {
                calculate();
            }
        })
        .catch((err) => {
            console.error(err)
        })
}

var calculate = function() {
    logsSmth(`Working on ${allViewed.length} watched content.`)

    totalTime = 0
    for (let obj of allViewed) {
        totalTime = totalTime + obj.bookmark
    }

    document.getElementById("watchtime").innerHTML = forHumans(totalTime); 
    document.getElementById("loader").style.display = "none";
    document.getElementById("content").style.display = "block";

}

var allViewed = []


fetchViewingActivity(0, 20)
