import "./style.css";
import p5 from "p5";

const sketch = (p) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
  };

  p.draw = () => {
    p.background(12, 16, 28, 40);
    const t = p.millis() * 0.001;
    for (let i = 0; i < 24; i += 1) {
      const x = p.width * 0.5 + Math.cos(t + i * 0.4) * (80 + i * 12);
      const y = p.height * 0.5 + Math.sin(t * 1.2 + i * 0.35) * (60 + i * 10);
      p.fill(80 + i * 6, 160 + (i % 5) * 12, 255, 180);
      p.circle(x, y, 18 + (i % 4) * 4);
    }
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
};

const mount = document.querySelector("#app");
new p5(sketch, mount);
