# Google Sheets Integration Setup Instructions

## Step 1: Create a Google Sheet
1. Go to https://sheets.google.com
2. Create a new spreadsheet
3. Name it "Glow Dental Appointments"
4. In the first row, add these column headers:
   - Column A: Name
   - Column B: Email
   - Column C: Phone
   - Column D: Date
   - Column E: Time
   - Column F: Message
   - Column G: Timestamp

## Step 2: Create Google Apps Script
1. In your Google Sheet, go to **Extensions** > **Apps Script**
2. Delete any code in the script editor
3. Copy and paste this code:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    // Append data to sheet
    sheet.appendRow([
      data.name,
      data.email,
      data.phone,
      data.date,
      data.time,
      data.message,
      data.timestamp
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      'result': 'success'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({
      'result': 'error',
      'error': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Click **Save** (disk icon)
5. Name the project "Dental Appointments"

## Step 3: Deploy the Script
1. Click **Deploy** > **New deployment**
2. Click the gear icon next to "Select type"
3. Select **Web app**
4. Fill in the settings:
   - Description: "Dental Appointment Form"
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**
6. Review permissions and click **Authorize access**
7. Choose your Google account
8. Click **Advanced** > **Go to [project name] (unsafe)**
9. Click **Allow**
10. **COPY THE WEB APP URL** - it will look like:
    `https://script.google.com/macros/s/AKfycbz.../exec`

## Step 4: Update Your Website
1. Open `appointment.html`
2. Find this line:
   ```javascript
   const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_SCRIPT_URL_HERE';
   ```
3. Replace `'YOUR_GOOGLE_SCRIPT_URL_HERE'` with your copied URL:
   ```javascript
   const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz.../exec';
   ```
4. Save the file

## Step 5: Test
1. Refresh your website
2. Go to the appointment page
3. Fill out and submit the form
4. Check your Google Sheet - the data should appear!

## Troubleshooting
- If data doesn't appear, check the browser console for errors (F12)
- Make sure the Google Apps Script is deployed as "Anyone" can access
- Verify the URL is copied correctly
- Wait a few seconds after submission for data to appear in the sheet

## Optional: Email Notifications
To receive email notifications when appointments are submitted, add this to your Apps Script:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    // Append data to sheet
    sheet.appendRow([
      data.name,
      data.email,
      data.phone,
      data.date,
      data.time,
      data.message,
      data.timestamp
    ]);
    
    // Send email notification
    var emailBody = `
New Appointment Request:

Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Date: ${data.date}
Time: ${data.time}
Message: ${data.message}
Submitted: ${data.timestamp}
    `;
    
    MailApp.sendEmail({
      to: 'your-email@example.com',  // Replace with your email
      subject: 'New Dental Appointment Request',
      body: emailBody
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      'result': 'success'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({
      'result': 'error',
      'error': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

Replace `'your-email@example.com'` with your actual email address.
