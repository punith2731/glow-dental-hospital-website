function callNow() {
  location.href = "tel:+919XXXXXXXXX";
}

function whatsapp() {
  window.open("https://wa.me/919XXXXXXXXX");
}

function toggleMenu() {
  const navbar = document.getElementById("navbar");
  const hamburger = document.getElementById("hamburger");

  if (!navbar || !hamburger) {
    return;
  }

  navbar.classList.toggle("show");
  hamburger.classList.toggle("active");

  document.body.style.overflow = navbar.classList.contains("show") ? "hidden" : "auto";
}

document.addEventListener("DOMContentLoaded", function () {
  const navLinks = document.querySelectorAll("nav a");

  navLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      const navbar = document.getElementById("navbar");
      const hamburger = document.getElementById("hamburger");

      if (navbar && hamburger && navbar.classList.contains("show")) {
        navbar.classList.remove("show");
        hamburger.classList.remove("active");
        document.body.style.overflow = "auto";
      }
    });
  });

  document.addEventListener("click", function (event) {
    const navbar = document.getElementById("navbar");
    const hamburger = document.getElementById("hamburger");
    const isClickInsideNav = navbar && navbar.contains(event.target);
    const isClickOnHamburger = hamburger && hamburger.contains(event.target);

    if (navbar && hamburger && !isClickInsideNav && !isClickOnHamburger && navbar.classList.contains("show")) {
      navbar.classList.remove("show");
      hamburger.classList.remove("active");
      document.body.style.overflow = "auto";
    }
  });
});