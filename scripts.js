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




var fetchViewingActivity = function(page, pageSize, allViewed=[]) {

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
                fetchViewingActivity(page+1, pageSize, allViewed);
            } else {
                calculate(allViewed);
            }
        })
        .catch((err) => {
            console.error(err)
        })
}


var calculate = function(allViewed) {
    logsSmth(`Working on ${allViewed.length} watched content.`)

    totalTime = 0
    for (let obj of allViewed) {
        totalTime = totalTime + obj.bookmark
    }

    /* Use modified version! || Too violent to be able to use */
    //var animationCountUp = new countUp.CountUp("watchtime", totalTime, forHumans, {duration: 10});
    //animationCountUp.start();
    document.getElementById("watchtime").innerHTML = forHumans(totalTime)
    document.getElementById("twitter-share-btn").setAttribute("href", `https://twitter.com/intent/tweet?text=I%20spent%20${forHumans(totalTime)}%20on%20Netflix!%0a%0aWanna%20discover%20how%20much%20time%20you%20spent?%0aDownload%20this%20free%20chrome%20extension%20⬇️&url=https://apps.ghr.lt/netflix-watchtime-extension`)

    document.getElementById("loader").style.display = "none";
    document.getElementById("content").style.display = "block";

}

fetchViewingActivity(0, 20);