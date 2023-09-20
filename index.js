const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');

const mongoURI = 'mongodb://127.0.0.1:27017/twilio'; // Replace with your MongoDB URI
const clientMongo = new MongoClient(mongoURI, {});

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const { VoiceResponse } = twilio.twiml;

// Load Twilio credentials from a .env file
require('dotenv').config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize the Twilio client
const client = twilio(accountSid, authToken);

// Connect to the MongoDB database
async function connectToMongo() {
    try {
        await clientMongo.connect();
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
        process.exit(1);
    }
}

// Middleware to handle MongoDB connection
app.use(async (req, res, next) => {
    await connectToMongo();
    next();
});

// Handle incoming calls
app.post('/voice', async (req, res) => {
    const twiml = new VoiceResponse();
    const selectedOption = req.body.Digits;
    const fromNumber = req.body.From;

    // Generate a unique call ID
    const callId = uuidv4();

    // Create a document to store call details
    const callDetails = {
        callId,
        fromNumber,
        selectedOption,
        timestamp: new Date(),
    };

    if (selectedOption === '1') {
        // Redirect the call to your personal phone
        twiml.dial({ callerId: twilioPhoneNumber }, fromNumber);

        // Make an outbound call to personal phone number
        const call = await client.calls.create({
            to: '+923129545139', // Replace with your personal phone number
            from: +15177934989,
            url: 'https://8119-39-43-210-40.ngrok-free.app/outbound-voice', // Replace with the URL for outbound voice handling
        });

        // Add a property to the callDetails document indicating the outbound call
        callDetails.outboundCallSid = call.sid;
        // Add a property to the callDetails document indicating it was redirected
        callDetails.redirected = true;
    } else if (selectedOption === '2') {
        // Automatically redirect to voicemail recording
        twiml.say('Please leave your message after the tone.');

        const response = new VoiceResponse();
        response.record();

        response.say('I did not receive a recording');
        // Add a property to the callDetails document indicating it was recorded as voicemail
        callDetails.voicemail = true;

        // Redirect to the /recorded-voicemail route
        twiml.redirect('/recorded-voicemail');

        await axios.post('http://localhost:5000/recorded-voicemail', { RecordingUrl: response.toString(), CallId: callId });

    } else {
        // Handle other options or provide a menu
        twiml.say('Invalid selection. Please try again.');
    }

    // Save the call details to MongoDB
    const callDetailsCollection = clientMongo.db().collection('call_details');
    try {
        await callDetailsCollection.insertOne(callDetails);
        console.log('Call details saved successfully:', callDetails);
    } catch (err) {
        console.error('Error saving call details to MongoDB:', err);
        res.status(500).send('Error saving call details');
        return;
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

// Handle recorded voicemail
app.post('/recorded-voicemail', async (req, res) => {
    const callId = req.body.CallId;
    const recordingUrl = req.body.RecordingUrl;

    // Create a document to store voicemail details
    const voicemailDetails = {
        callId,
        recordingUrl,
        timestamp: new Date(),
    };

    // Save the voicemail details to MongoDB
    const voicemailCollection = clientMongo.db().collection('voicemail_details');
    try {
        await voicemailCollection.insertOne(voicemailDetails);
        console.log('Voicemail details saved successfully:', voicemailDetails);
    } catch (err) {
        console.error('Error saving voicemail details to MongoDB:', err);
        res.status(500).send('Error saving voicemail details');
        return;
    }

    const twiml = new VoiceResponse();
    twiml.say('Thank you for leaving a voicemail.');

    res.type('text/xml');
    res.send(twiml.toString());
});

app.get('/activity-feed', async (req, res) => {
    try {
        const callDetailsCollection = clientMongo.db().collection('call_details');

        // Fetch all call details
        const callDetails = await callDetailsCollection.find().toArray();

        // Fetch voicemail details for all calls that have voicemail
        const activityFeed = await Promise.all(
            callDetails.map(async (call) => {
                const voicemailCollection = clientMongo.db().collection('voicemail_details');

                const voicemail = await voicemailCollection.findOne({
                    callId: call.callId, 
                });

                return {
                    callId: call.callId,
                    fromNumber: call.fromNumber,
                    selectedOption: call.selectedOption,
                    timestamp: call.timestamp,
                    redirected: call.redirected,
                    voicemail: voicemail ? voicemail.recordingUrl : null,
                };
            })
        );

        res.json(activityFeed);
    } catch (err) {
        console.error('Error fetching activity feed:', err);
        res.status(500).send('Error fetching activity feed');
    }
});

process.on('SIGINT', () => {
    clientMongo.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
});

// Start the Express server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
