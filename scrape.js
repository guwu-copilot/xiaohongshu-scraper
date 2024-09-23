const puppeteer = require('puppeteer');
const fs = require('fs').promises; // Import the fs module to read and write files

// Function to convert Chinese numeric format to integer
function parseChineseNumber(value) {
  if (value.includes('万')) {
    return parseFloat(value.replace('万', '')) * 10000;
  }
  return parseFloat(value);
}

// Function to convert date format from "YYYY-MM-DD" to "M/DD"
function formatDate(dateStr) {
  // Check if the date string is already in the "M/DD" format
  if (dateStr.includes('/')) {
    return dateStr; // If it's already in "M/DD", return as is
  }

  // If dateStr is in "YYYY-MM-DD" format, convert it to "M/DD"
  const dateParts = dateStr.split('-');
  const year = dateParts[0];
  const month = parseInt(dateParts[1], 10); // Remove leading zero
  const day = parseInt(dateParts[2], 10);   // Remove leading zero

  return `${month}/${day}`;
}

(async () => {
  try {
    // Launch Puppeteer in non-headless mode for debugging
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null, // Disable the default viewport to use the full window size
      args: ['--window-size=1600,4800'] // Set the window size to 1600x800
    });

    const page = await browser.newPage();

    // Set User-Agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36');

    // Set viewport size to ensure visibility of all elements
    await page.setViewport({ width: 1600, height: 4800 });

    // Load cookies from the JSON file
    const cookies = JSON.parse(await fs.readFile('cookies.json', 'utf8')).map(cookie => {
      // Ensure the sameSite attribute is valid
      if (!['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
        cookie.sameSite = 'Lax'; // Default to 'Lax' if not set or invalid
      }
      return cookie;
    });

    // Set cookies in Puppeteer
    await page.setCookie(...cookies);

    // Increase navigation timeout
    await page.setDefaultNavigationTimeout(60000); // Set navigation timeout to 60 seconds

    // Navigate to the target page
    await page.goto('https://creator.xiaohongshu.com/creator/notes', { waitUntil: 'networkidle2' });

    // Function to scroll to the bottom of the page to ensure all content is loaded
    async function scrollToBottom() {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
    }

    // Initialize an array to store all collected data
    const allPostsData = [];

    // Define the selector for the "Next" button
    const nextButtonSelector = '.page-actions button:nth-last-child(2)';

    // Loop through pages 1 to 8
    let pageNumber = 1;
    while (pageNumber <= 8) {
      console.log(`Scraping page ${pageNumber}...`);

      // Scroll to the bottom to load all content
      await scrollToBottom();

      // Wait for the info list to load
      await page.waitForSelector('.info-list', { timeout: 60000 });

      // Extract metrics, titles, and publish times from the current page
      const postsData = await page.evaluate(() => {
        const posts = [];
        const infoLists = document.querySelectorAll('.info-list');

        infoLists.forEach(infoList => {
          const postData = {
            "爆款": false, // Default value for 爆款
            "阅读": "0",   // Default value for 阅读
            "点赞": "0",   // Default value for 点赞
            "收藏": "0",   // Default value for 收藏
            "评论": "0",   // Default value for 评论
            "分享": "0",   // Default value for 分享
            "笔记涨粉": "0" // Default value for 笔记涨粉
          };

          // Extract the title from the info-text class
          const titleElement = infoList.parentElement.querySelector('.info-text .title');
          if (titleElement) {
            postData['标题'] = titleElement.innerText.trim(); // Add title as 标题
          }

          // Extract the publish date
          const publishTimeElement = infoList.parentElement.querySelector('.info-text .publish-time');
          if (publishTimeElement) {
            postData['发布日期'] = publishTimeElement.innerText.replace('发布于', '').trim(); // Extract and clean publish date
          }

          const listItems = infoList.querySelectorAll('li');

          listItems.forEach(item => {
            const label = item.querySelector('label');
            const valueElement = item.querySelector('b');

            if (label && valueElement) {
              const key = label.innerText.trim(); // Use the label text as the key
              const value = valueElement.innerText.trim(); // Get the value from the <b> tag

              // Map keys to expected Google Sheet headers
              switch (key) {
                case '观看量':
                  postData['阅读'] = value; // Assign 观看量 to 阅读
                  break;
                case '点赞量':
                  postData['点赞'] = value;
                  break;
                case '收藏数':
                  postData['收藏'] = value;
                  break;
                case '评论数':
                  postData['评论'] = value;
                  break;
                case '分享数':
                  postData['分享'] = value;
                  break;
                case '直接涨粉数':
                  postData['笔记涨粉'] = value;
                  break;
                default:
                  break;
              }
            }
          });

          // Add the postData object to the posts array
          if (Object.keys(postData).length > 0) {
            posts.push(postData);
          }
        });

        return posts;
      });

      // Convert and process the data outside of evaluate
      postsData.forEach(post => {
        // Convert 阅读 to a number and check if it's a 爆款
        const parsed阅读 = parseChineseNumber(post['阅读']);
        post['阅读'] = parsed阅读;
        post['爆款'] = parsed阅读 > 10000;
      
        // Format 日期 to M/DD
        if (post['发布日期']) {
          post['发布日期'] = formatDate(post['发布日期']);
        }
      
        allPostsData.push(post);
      });

      // Check if there is a "Next" button and it's enabled before clicking
      const nextButton = await page.$(nextButtonSelector);
      if (nextButton) {
        const isDisabled = await page.evaluate((btn) => btn.disabled, nextButton);
        if (!isDisabled) {
          try {
            // Make sure the "Next" button is in view
            await nextButton.scrollIntoViewIfNeeded();
            
            // Click the "Next" button and wait for some content to change
            await Promise.all([
              nextButton.click(), // Click the "Next" button
              page.waitForSelector('.info-list', { visible: true, timeout: 60000 }), // Wait for content to change
            ]);
            pageNumber++; // Increment page number after successful navigation
          } catch (navError) {
            console.error('Error during navigation:', navError);
            break; // Exit if there is a navigation error
          }
        } else {
          console.log('Next button is disabled. Ending pagination.');
          break;
        }
      } else {
        console.log('Next button not found. Ending pagination.');
        break;
      }
    }

    // Sort the posts data by publish date (发布日期)
    allPostsData.sort((a, b) => new Date(b['发布日期']) - new Date(a['发布日期']));

    // Convert the posts data to CSV format
    const csvData = allPostsData.map(post => {
      return [
        `"北美省钱快报"`, // Static value for the first column
        `"Jade"`,        // Static value for the second column
        `""`,            // Empty value for the third column
        `"${post['发布日期'] || ''}"`, // Format date to M/DD
        `"${post['标题'] || ''}"`,
        `${post['爆款'] ? 'TRUE' : 'FALSE'}`, // Use TRUE or FALSE without quotes for Google Sheets checkbox
        `"${post['阅读'] || ''}"`,
        `"${post['点赞'] || ''}"`,
        `"${post['收藏'] || ''}"`,
        `"${post['评论'] || ''}"`,
        `"${post['分享'] || ''}"`,
        `"${post['笔记涨粉'] || ''}"`
      ].join(',');
    });

    // Add a header row to the CSV data
    const csvHeader = '账号,制作人,发布类型,发布日期,标题,爆款,阅读,点赞,收藏,评论,分享,笔记涨粉';
    const csvContent = [csvHeader, ...csvData].join('\n');

    // Write the CSV data to a file
    await fs.writeFile('posts_data.csv', csvContent);

    console.log('Data successfully written to posts_data.csv');

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error('Error scraping data:', error);
  }
})();
