import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'cs-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
