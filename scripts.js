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




var fetchViewingActivity = function(page, pageSize, allViewed=[], devMode=false) {
    logsSmth("Fetching page " + page + " of your Netflix history...")

    fetch(`https://www.netflix.com/shakti/mre/viewingactivity?pgSize=${pageSize}&pg=${page}`)
        .then((resp) => {
            if (resp.status === 200) {
                return resp.json()
            } else {
                logsSmth("Error fetching your Netflix history.<br>Please check that you are logged in and try again later.")
                throw new Error("Code " + resp.status + " while fetching Netflix history.")
            }
        })
        .then((data) => {
            if ((data.viewedItems.length !== 0) && !(devMode && page >= 5)) { // devMode: only fetch 5 pages
                Array.prototype.push.apply(allViewed, data.viewedItems);
                fetchViewingActivity(page+1, pageSize, allViewed, devMode);
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
    today = 0
    month = 0
    year = 0
    before = 0

    dayHours = {
        "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0,
        "7": 0, "8": 0, "9": 0, "10": 0, "11": 0, "12": 0,
        "13": 0, "14": 0, "15": 0, "16": 0, "17": 0, "18": 0,
        "19": 0, "20": 0, "21": 0, "22": 0, "23": 0, "24": 0
    }

    isMovie = 0
    isSeries = 0

    for (let obj of allViewed) {
        /** Calculate the total time per period **/
        totalTime = totalTime + obj.bookmark

        todayMidnight = new Date()
        todayMidnight.setUTCHours(0,0,0,0)
        startMonthMidnight = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
        startYearMidnight = new Date(new Date().getUTCFullYear(), 0, 1)


        if (obj.date >= todayMidnight) {
            today = today + obj.bookmark
        }
        if (obj.date >= startMonthMidnight) {
            month = month + obj.bookmark
        }
        if (obj.date >= startYearMidnight) {
            year = year + obj.bookmark
        } else {
            before += obj.bookmark
        }

        /** Calculate the consumption per hour **/
        dayHours[new Date(obj.date).getHours()]++;
        


        /** Get movie/series count **/
        if (obj.series) {
            isSeries++
        } else {
            isMovie++
        }

    }



    /* Use modified version! || Too violent to be able to use */
    //var animationCountUp = new countUp.CountUp("watchtime", totalTime, forHumans, {duration: 10});
    //animationCountUp.start();
    document.getElementById("total-stat").innerHTML = forHumans(totalTime)

    /** Generate pie for watching period **/
    const ctx = document.getElementById('timeproportion').getContext("2d");
    var data = {
        labels: ['Today', 'This month', 'This year', 'Before'],
        datasets: [{
            label: 'Time proportion',
            data: [today, month, year, before],
            backgroundColor: [
                'rgba(255, 99, 132, 0.7)',
                'rgba(54, 162, 235, 0.7)',
                'rgba(255, 206, 86, 0.7)'
            ],
            borderColor: [
                'rgba(255, 99, 132, 1)',
                'rgba(54, 162, 235, 1)',
                'rgba(255, 206, 86, 1)'
            ],
            borderWidth: 1
        }]
    }
    new Chart(ctx, {
        type: 'pie',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                    position: 'bottom',
                },
                title: {
                    display: true,
                    text: 'Time proportion'
                },
                tooltip: {
                    callbacks: {
                        label: function(tooltipItem) {
                            return forHumans(data.datasets[0].data[tooltipItem.dataIndex])
                        }
                    }
                }
            }
        }
    });

    /** Generate pie for movie/series count **/
    const ctx2 = document.getElementById('contentproportion').getContext("2d");
    var data2 = {
        labels: ['Movies', 'Series (episodes)'],
        datasets: [{
            label: 'Content proportion',
            data: [isMovie, isSeries],
            backgroundColor: [
                'rgba(255, 99, 132, 0.7)',
                'rgba(54, 162, 235, 0.7)'
            ],
            borderColor: [
                'rgba(255, 99, 132, 1)',
                'rgba(54, 162, 235, 1)'
            ],


            borderWidth: 1
        }]
    }
    new Chart(ctx2, {
        type: 'pie',
        data: data2,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                    position: 'bottom',
                },
                title: {
                    display: true,
                    text: 'Content proportion'
                },
                tooltip: {
                    callbacks: {
                        label: function(tooltipItem) {
                            return data2.datasets[0].data[tooltipItem.dataIndex]
                        }
                    }
                }
            }
        }
    });

    /** Generate bar for watching per hour **/
    const ctx3 = document.getElementById('hourproportion').getContext("2d");
    var data3 = {
        labels: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'],
        datasets: [{
            label: 'Hour proportion',
            data: [dayHours["0"], dayHours["1"], dayHours["2"], dayHours["3"], dayHours["4"], dayHours["5"], dayHours["6"], dayHours["7"], dayHours["8"], dayHours["9"], dayHours["10"], dayHours["11"], dayHours["12"], dayHours["13"], dayHours["14"], dayHours["15"], dayHours["16"], dayHours["17"], dayHours["18"], dayHours["19"], dayHours["20"], dayHours["21"], dayHours["22"], dayHours["23"], dayHours["24"]], // Find a way to get the values from the object
            backgroundColor: [
                'rgba(255, 99, 132, 0.7)',
                'rgba(54, 162, 235, 0.7)',
                'rgba(255, 206, 86, 0.7)'
            ],
            borderColor: [
                'rgba(255, 99, 132, 1)',
                'rgba(54, 162, 235, 1)',
                'rgba(255, 206, 86, 1)'
            ],
            borderWidth: 1
        }]
    }
    new Chart(ctx3, {
        type: 'bar',
        data: data3,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                    position: 'bottom',
                },
                title: {
                    display: true,
                    text: 'Watching hours proportion'
                },
                tooltip: {
                    enabled: false
                }
            }
        }
    });



    document.getElementById("twitter-share-btn").setAttribute("href", `https://twitter.com/intent/tweet?text=I%20spent%20${forHumans(totalTime)}%20on%20Netflix!%0a%0aWanna%20discover%20how%20much%20time%20you%20spent?%0aDownload%20this%20free%20chrome%20extension%20⬇️&url=https://apps.ghr.lt/netflix-watchtime-extension`)

    document.getElementById("loader").style.display = "none";
    document.getElementById("content").style.display = "block";

}

fetchViewingActivity(0, 20, [], false);