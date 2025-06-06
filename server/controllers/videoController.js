const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { body, validationResult } = require('express-validator');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const fileExt = path.extname(file.originalname);
    cb(null, `${fileId}${fileExt}`);
  }
});

const upload = multer({
  storage,
  limits: { 
    fileSize: 1024 * 1024 * 1024, // 1GB limit (1024MB)
    fieldSize: 1024 * 1024 * 1024, // 1GB for field data
    fields: 50, // Maximum number of non-file fields
    files: 1, // Maximum number of file fields
    parts: 1000 // Maximum number of parts
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.mp3', '.wav', '.m4a'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('סוג קובץ לא נתמך. מותרים רק קבצי וידאו ואודיו.'));
    }
  }
}).single('video');

/**
 * Extract YouTube video ID from various URL formats
 * @param {string} url - YouTube URL
 * @returns {string|null} - Video ID or null if not found
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;
  
  console.log('Attempting to extract video ID from URL:', url);
  
  // Clean the URL first and extract using URL parsing
  try {
    const urlObj = new URL(url);
    
    // Handle youtube.com URLs
    if (urlObj.hostname.includes('youtube.com')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId && videoId.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        console.log('Extracted video ID from youtube.com URL params:', videoId);
        return videoId;
      }
    }
    
    // Handle youtu.be URLs (including with query parameters)
    if (urlObj.hostname.includes('youtu.be')) {
      const videoId = urlObj.pathname.replace('/', '');
      if (videoId && videoId.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        console.log('Extracted video ID from youtu.be URL:', videoId);
        return videoId;
      }
    }
  } catch (urlError) {
    console.log('URL parsing failed, trying regex fallback:', urlError.message);
  }
  
  // First try the standard YouTube URL validation
  if (ytdl.validateURL(url)) {
    try {
      const videoId = ytdl.getURLVideoID(url);
      console.log('Extracted video ID using ytdl.getURLVideoID:', videoId);
      return videoId;
    } catch (e) {
      console.log("Standard ytdl extraction failed:", e.message);
    }
  }
  
  // If that fails, try regex patterns for different URL formats
  try {
    // Enhanced regex for youtu.be URLs with parameters
    const youtuBeRegex = /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:\?.*)?/;
    const youtuBeMatch = url.match(youtuBeRegex);
    
    if (youtuBeMatch && youtuBeMatch[1]) {
      console.log('Extracted video ID from youtu.be regex:', youtuBeMatch[1]);
      return youtuBeMatch[1];
    }
    
    // Handle standard YouTube URLs
    const standardRegex = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const standardMatch = url.match(standardRegex);
    
    if (standardMatch && standardMatch[2].length === 11) {
      console.log('Extracted video ID from standard URL format:', standardMatch[2]);
      return standardMatch[2];
    }
    
    // Specific handler for youtube.com/watch?v= format
    const watchRegex = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/;
    const watchMatch = url.match(watchRegex);
    
    if (watchMatch && watchMatch[1]) {
      console.log('Extracted video ID from youtube.com/watch?v= format:', watchMatch[1]);
      return watchMatch[1];
    }
    
    // Handle youtu.be format better (including youtu.be/* wildcard)
    const shortRegex = /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/;
    const shortMatch = url.match(shortRegex);
    
    if (shortMatch && shortMatch[1]) {
      console.log('Extracted video ID from youtu.be URL:', shortMatch[1]);
      return shortMatch[1];
    }
    
    // Special handling for youtu.be wildcard format with query parameters
    if (url.includes('youtu.be/')) {
      const parts = url.split('youtu.be/');
      if (parts.length >= 2) {
        const idPart = parts[1].split(/[?#&]/)[0]; // Remove query params and hash
        if (idPart && idPart.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(idPart)) {
          console.log('Extracted video ID from special youtu.be format:', idPart);
          return idPart;
        }
      }
    }
    
    // Handle URLs with ID in path segments
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      for (const segment of segments) {
        if (segment.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(segment)) {
          console.log('Extracted video ID from URL path segments:', segment);
          return segment;
        }
      }
    } catch (segmentError) {
      // Ignore URL parsing errors for path segment extraction
    }
  } catch (e) {
    console.log("Regex extraction failed:", e.message);
  }
  
  return null;
}

/**
 * Process a YouTube video URL
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
exports.processVideoUrl = async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'YouTube URL is required'
      });
    }

    // Extract video ID from the URL
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract video ID from the provided URL. Please check the URL format.'
      });
    }
    
    console.log(`Processing YouTube video ID: ${videoId} from URL: ${url}`);

    // Create a clean URL for ytdl-core
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Try to get video info directly using the clean URL
    try {
      const videoInfo = await ytdl.getInfo(cleanUrl);
      const title = videoInfo.videoDetails.title;
      const duration = parseInt(videoInfo.videoDetails.lengthSeconds);
      
      // Return basic video info
      return res.status(200).json({
        success: true,
        data: {
          videoId,
          title,
          duration,
          url: cleanUrl // Return the clean URL for consistency
        }
      });
    } catch (infoError) {
      console.error('Error getting video info with clean URL:', infoError);
      
      // Fall back to using the original URL
      try {
        const videoInfo = await ytdl.getInfo(url);
        const title = videoInfo.videoDetails.title;
        const duration = parseInt(videoInfo.videoDetails.lengthSeconds);
        
        return res.status(200).json({
          success: true,
          data: {
            videoId,
            title,
            duration,
            url
          }
        });
      } catch (fallbackError) {
        // If both attempts fail but we have the video ID, provide a mock response
        console.error('Error getting video info with URL fallback:', fallbackError);
        
        // Instead of completely failing, provide basic info since we have the ID
        if (videoId) {
          console.log('Providing mock response for video ID:', videoId);
          return res.status(200).json({
            success: true,
            data: {
              videoId,
              title: `YouTube Video (${videoId})`,
              duration: 0, // Unknown duration
              url: cleanUrl,
              note: 'Basic info only due to YouTube API limitations'
            }
          });
        } else {
          throw new Error(`Failed to get video info: ${infoError.message}. Fallback also failed: ${fallbackError.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Error processing YouTube URL:', error);
    
    // Provide more detailed error message
    let errorMessage = 'Error processing YouTube URL';
    if (error.message.includes('Could not extract')) {
      errorMessage = 'YouTube API change detected. Please try a different URL format or update ytdl-core.';
    } else if (error.message.includes('Video unavailable')) {
      errorMessage = 'The video is unavailable or private. Please check the URL and try again.';
    } else if (error.message.includes('functions')) {
      errorMessage = 'YouTube has updated their system. Try using the Chrome extension instead for better compatibility.';
    }
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      url: req.body.url
    });
  }
};

/**
 * Upload a video file
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
exports.uploadVideo = (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded'
      });
    }

    const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
    
    // Try to get video duration with ffprobe, but handle the case when it's not available
    try {
      ffmpeg.ffprobe(req.file.path, (err, metadata) => {
        if (err) {
          console.error('Error getting video metadata:', err);
          
          // Return response without duration if ffprobe fails
          return res.status(200).json({
            success: true,
            data: {
              fileId,
              filename: req.file.filename,
              originalName: req.file.originalname,
              size: req.file.size,
              path: req.file.path,
              duration: 0, // Unknown duration
              ffprobeError: 'Failed to detect video duration: ' + err.message
            }
          });
        }
        
        const duration = Math.floor(metadata.format.duration);
        
        return res.status(200).json({
          success: true,
          data: {
            fileId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            path: req.file.path,
            duration
          }
        });
      });
    } catch (ffmpegError) {
      console.error('Critical ffmpeg error:', ffmpegError);
      
      // Still return success but with a note about the missing ffmpeg
      return res.status(200).json({
        success: true,
        data: {
          fileId,
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          path: req.file.path,
          duration: 0, // Unknown duration
          ffmpegError: 'FFmpeg not available: ' + ffmpegError.message
        }
      });
    }
  });
};

/**
 * Get video information
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
exports.getVideoInfo = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if it's a YouTube video ID
    if (ytdl.validateID(id)) {
      const videoInfo = await ytdl.getInfo(id);
      return res.status(200).json({
        success: true,
        data: {
          videoId: videoInfo.videoDetails.videoId,
          title: videoInfo.videoDetails.title,
          duration: parseInt(videoInfo.videoDetails.lengthSeconds),
          author: videoInfo.videoDetails.author.name,
          thumbnails: videoInfo.videoDetails.thumbnails
        }
      });
    } else {
      // Assume it's a file ID
      const uploadsDir = path.join(__dirname, '../uploads');
      const files = fs.readdirSync(uploadsDir);
      const videoFile = files.find(file => file.startsWith(id));
      
      if (!videoFile) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }
      
      const filePath = path.join(uploadsDir, videoFile);
      
      // Try to use ffprobe but handle the case when it's not available
      try {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.error('Error getting video metadata:', err);
            
            // Return response with file info but without additional metadata
            const stats = fs.statSync(filePath);
            return res.status(200).json({
              success: true,
              data: {
                fileId: id,
                filename: videoFile,
                duration: 0, // Unknown duration
                size: stats.size,
                format: path.extname(videoFile).replace('.', '')
              }
            });
          }
          
          return res.status(200).json({
            success: true,
            data: {
              fileId: id,
              filename: videoFile,
              duration: Math.floor(metadata.format.duration),
              size: metadata.format.size,
              format: metadata.format.format_name
            }
          });
        });
      } catch (ffmpegError) {
        console.error('Critical ffmpeg error:', ffmpegError);
        
        // Return basic file info without ffmpeg metadata
        const stats = fs.statSync(filePath);
        return res.status(200).json({
          success: true,
          data: {
            fileId: id,
            filename: videoFile,
            duration: 0, // Unknown duration
            size: stats.size,
            format: path.extname(videoFile).replace('.', '')
          }
        });
      }
    }
  } catch (error) {
    console.error('Error getting video info:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting video info',
      error: error.message
    });
  }
};
