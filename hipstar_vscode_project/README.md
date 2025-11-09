HipStar VSCode Project

To run locally:
cd public
python -m http.server 8000
open http://localhost:8000

To deploy to Firebase:
firebase init hosting
# choose 'public' as public directory
firebase deploy
