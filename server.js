import "dotenv/config"; // sabse pehle, taaki baaki modules ko env mile
import app from "./app.js";
import { startExpiryJob } from "./src/jobs/expiry.job.js";



const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  startExpiryJob();
});

