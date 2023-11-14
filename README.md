<img src="https://raw.githubusercontent.com/ghrlt/netflix-watchtime/master/medias/banner.png" alt="A banner featuring the extension logo">

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](http://www.gnu.org/licenses/gpl-3.0)
![](https://komarev.com/ghpvc/?username=ghrlt-netflix-watchtime&color=brightgreen&label=Repository%20views)  

# Netflix Watchtime

View and get a small analysis of your Netflix watchtime.
<br>

Todo: Better analysis, Requests optimization, Global watchtime leaderboard
<br><br>

## Installation

Install via the [Chrome Web Store](https://chrome.google.com/webstore/detail/netflix-watchtime/pncajjondflmmdmidcgcahcabjhmabfc)

Install from source:
- Download the repo -> [here](https://github.com/ghrlt/netflix-watchtime/archive/refs/heads/master.zip)
- Extract the downloaded ZIP
- Open your Chromium based browser, and go to chrome://extensions
- Enable developer mode, and click on "Load unpacked"
- Select the previously extracted folder
- Here you go! The extension is now installed. Find its icon on your browser extension bar and click it.


### Adding a traduction

Thanks for your interest in this project! Here are the instructions on how to add a traduction:

- Fork the repository
- Create a new folder under `_locales` named with the locale of your choice ([See supported locales](https://developer.chrome.com/docs/extensions/reference/i18n/#supported-locales))
- Copy the english [messages.json](https://github.com/ghrlt/netflix-watchtime/blob/master/_locales/en/messages.json) file, and paste it in your folder
- Modify *all* of the `messages` key values
    Example:
    ```json
    "shareResults": {
        "message": "Share your results!"
    }
    ```
    this shall became this in the event of a French traduction
    
    ```json
    "shareResults": {
        "message": "Partagez vos résultats !"
    }
    ```
- Once you're done, commit your local changes and make a pull request!
    - I will check and push whenenver I can