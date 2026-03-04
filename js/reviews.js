function formatReviewDate(createdAt) {
  const date = createdAt ? new Date(createdAt) : new Date();
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderReviews(reviews) {
  const reviewsList = document.getElementById('reviewsList');
  const reviewCount = document.getElementById('reviewCount');

  reviewCount.textContent = `${reviews.length} review${reviews.length !== 1 ? 's' : ''}`;

  if (reviews.length === 0) {
    reviewsList.innerHTML = '<p class="no-reviews">No reviews yet. Be the first to leave a review!</p>';
    return;
  }

  reviewsList.innerHTML = reviews.map(review => `
    <div class="review-item">
      <div class="review-header">
        <div>
          <h3>${review.name}</h3>
          <p class="review-date">${formatReviewDate(review.createdAt || review.submittedAt)}</p>
        </div>
        <div class="review-rating">${'⭐'.repeat(review.rating)}</div>
      </div>
      <p class="review-text">${review.text}</p>
    </div>
  `).join('');
}

function startRealtimeReviews() {
  const reviewsList = document.getElementById('reviewsList');
  const reviewCount = document.getElementById('reviewCount');

  if (!window.firebaseBackend || !window.firebaseBackend.isConfigured) {
    reviewCount.textContent = '0 reviews';
    reviewsList.innerHTML = '<p class="no-reviews">Firebase is not configured yet. Add your Firebase keys in <code>firebase.js</code>.</p>';
    return;
  }

  window.firebaseBackend.subscribeReviews(
    function (reviews) {
      renderReviews(reviews);
    },
    function (error) {
      console.error('Realtime review sync failed:', error);
      reviewsList.innerHTML = '<p class="no-reviews">Unable to sync reviews right now. Please try again later.</p>';
    }
  );
}

// Submit review
function initReviewForm() {
  const reviewForm = document.getElementById('reviewForm');
  
  if (!reviewForm) {
    return;
  }

  reviewForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!window.firebaseBackend || !window.firebaseBackend.isConfigured) {
      alert('Firebase is not configured. Please update firebase.js first.');
      return;
    }
    
    const name = document.getElementById('reviewName').value;
    const email = document.getElementById('reviewEmail').value;
    const ratingInput = document.querySelector('input[name="rating"]:checked');
    
    if (!ratingInput) {
      alert('Please select a rating!');
      return;
    }
    
    const rating = parseInt(ratingInput.value);
    const text = document.getElementById('reviewText').value;
    
    const review = {
      name: name,
      email: email,
      rating: rating,
      text: text,
      submittedAt: new Date().toISOString()
    };

    const submitButton = this.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Submitting...';
    submitButton.disabled = true;

    try {
      await window.firebaseBackend.saveReview(review);
      this.reset();
      alert('Thank you for your review! Your feedback has been submitted successfully.');
      document.getElementById('reviewsList').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      console.error('Review submission failed:', error);
      alert('Unable to submit your review at the moment. Please try again.');
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  });
}

// Load reviews on page load
document.addEventListener('DOMContentLoaded', function() {
  startRealtimeReviews();
  initReviewForm();
});
